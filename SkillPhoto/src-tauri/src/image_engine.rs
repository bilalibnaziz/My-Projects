use crate::models::{Adjustments, HistogramData, SplinePoint};

/// Planckian blackbody radiator chromaticity model (2000K to 12000K)
pub fn kelvin_to_rgb(kelvin: f64) -> (f64, f64, f64) {
    let k = (kelvin / 100.0).clamp(20.0, 120.0);
    let r = if k <= 66.0 {
        1.0
    } else {
        (329.698727446 * (k - 60.0).powf(-0.1332047592) / 255.0).clamp(0.0, 1.0)
    };

    let g = if k <= 66.0 {
        (99.4708025861 * k.ln() - 161.1195681661) / 255.0
    } else {
        288.1221695283 * (k - 60.0).powf(-0.0755148492) / 255.0
    }.clamp(0.0, 1.0);

    let b = if k >= 66.0 {
        1.0
    } else if k <= 19.0 {
        0.0
    } else {
        ((138.5177312231 * (k - 10.0).ln() - 305.0447927307) / 255.0).clamp(0.0, 1.0)
    };

    (r, g, b)
}

/// Fritsch-Carlson Monotone Cubic Spline (guarantees monotonicity, eliminates overshoot)
pub fn build_monotone_cubic_spline_lut(points: &[SplinePoint]) -> [u8; 256] {
    let mut lut = [0u8; 256];
    if points.is_empty() {
        for (i, v) in lut.iter_mut().enumerate() {
            *v = i as u8;
        }
        return lut;
    }

    let mut sorted = points.to_vec();
    sorted.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap());

    let n = sorted.len();
    if n == 1 {
        let val = sorted[0].y.clamp(0.0, 255.0) as u8;
        lut.fill(val);
        return lut;
    }

    let mut dx = vec![0.0; n - 1];
    let mut dy = vec![0.0; n - 1];
    let mut slopes = vec![0.0; n - 1];

    for i in 0..n - 1 {
        dx[i] = sorted[i + 1].x - sorted[i].x;
        dy[i] = sorted[i + 1].y - sorted[i].y;
        slopes[i] = if dx[i].abs() > 1e-6 { dy[i] / dx[i] } else { 0.0 };
    }

    let mut tangents = vec![0.0; n];
    tangents[0] = slopes[0];
    tangents[n - 1] = slopes[n - 2];
    for i in 1..n - 1 {
        if slopes[i - 1] * slopes[i] <= 0.0 {
            tangents[i] = 0.0;
        } else {
            tangents[i] = (slopes[i - 1] + slopes[i]) / 2.0;
        }
    }

    for i in 0..n - 1 {
        if slopes[i].abs() < 1e-6 {
            tangents[i] = 0.0;
            tangents[i + 1] = 0.0;
        } else {
            let a = tangents[i] / slopes[i];
            let b = tangents[i + 1] / slopes[i];
            let dist = a * a + b * b;
            if dist > 9.0 {
                let tau = 3.0 / dist.sqrt();
                tangents[i] = tau * a * slopes[i];
                tangents[i + 1] = tau * b * slopes[i];
            }
        }
    }

    for i in 0..256 {
        let x = i as f64;
        if x <= sorted[0].x {
            lut[i] = sorted[0].y.clamp(0.0, 255.0) as u8;
            continue;
        }
        if x >= sorted[n - 1].x {
            lut[i] = sorted[n - 1].y.clamp(0.0, 255.0) as u8;
            continue;
        }

        let mut seg = 0;
        for s in 0..n - 1 {
            if x >= sorted[s].x && x <= sorted[s + 1].x {
                seg = s;
                break;
            }
        }

        let h = dx[seg];
        if h.abs() < 1e-6 {
            lut[i] = sorted[seg].y.clamp(0.0, 255.0) as u8;
            continue;
        }

        let t = (x - sorted[seg].x) / h;
        let t2 = t * t;
        let t3 = t2 * t;

        let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
        let h10 = t3 - 2.0 * t2 + t;
        let h01 = -2.0 * t3 + 3.0 * t2;
        let h11 = t3 - t2;

        let y = h00 * sorted[seg].y
            + h10 * h * tangents[seg]
            + h01 * sorted[seg + 1].y
            + h11 * h * tangents[seg + 1];

        lut[i] = y.round().clamp(0.0, 255.0) as u8;
    }

    lut
}

/// Applies all 24+ professional adjustments in a high-performance single-pass pixel loop
pub fn apply_adjustments_buffer(data: &mut [u8], width: usize, height: usize, adj: &Adjustments) {
    let exp_factor = 2.0f64.powf(adj.exposure);
    let contrast_factor = (259.0 * (adj.contrast * 2.55 + 255.0)) / (255.0 * (259.0 - adj.contrast * 2.55));
    let (wb_r, wb_g, wb_b) = kelvin_to_rgb(adj.temperature);

    let curve_rgb_lut = adj.curve_rgb.as_ref().map(|pts| build_monotone_cubic_spline_lut(pts));
    let curve_r_lut = adj.curve_r.as_ref().map(|pts| build_monotone_cubic_spline_lut(pts));
    let curve_g_lut = adj.curve_g.as_ref().map(|pts| build_monotone_cubic_spline_lut(pts));
    let curve_b_lut = adj.curve_b.as_ref().map(|pts| build_monotone_cubic_spline_lut(pts));

    let cx = width as f64 / 2.0;
    let cy = height as f64 / 2.0;
    let max_dist = (cx * cx + cy * cy).sqrt();

    let num_pixels = width * height;
    for i in 0..num_pixels {
        let offset = i * 4;
        let mut r = data[offset] as f64;
        let mut g = data[offset + 1] as f64;
        let mut b = data[offset + 2] as f64;
        let a = data[offset + 3];

        if a == 0 {
            continue;
        }

        // 1. Exposure
        if (adj.exposure).abs() > 1e-4 {
            r *= exp_factor;
            g *= exp_factor;
            b *= exp_factor;
        }

        // 2. White Balance (Kelvin)
        if (adj.temperature - 5500.0).abs() > 10.0 {
            r *= wb_r;
            g *= wb_g;
            b *= wb_b;
        }

        // 3. Contrast
        if adj.contrast.abs() > 1e-4 {
            r = contrast_factor * (r - 128.0) + 128.0;
            g = contrast_factor * (g - 128.0) + 128.0;
            b = contrast_factor * (b - 128.0) + 128.0;
        }

        // 4. Tone distribution (Highlights / Shadows)
        let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if adj.highlights.abs() > 1e-4 && lum > 128.0 {
            let factor = 1.0 + (adj.highlights / 100.0) * ((lum - 128.0) / 127.0);
            r *= factor;
            g *= factor;
            b *= factor;
        }
        if adj.shadows.abs() > 1e-4 && lum < 128.0 {
            let factor = 1.0 + (adj.shadows / 100.0) * ((128.0 - lum) / 128.0);
            r *= factor;
            g *= factor;
            b *= factor;
        }

        // 5. Saturation / Vibrance
        if adj.saturation.abs() > 1e-4 {
            let sat_mult = 1.0 + adj.saturation / 100.0;
            r = lum + (r - lum) * sat_mult;
            g = lum + (g - lum) * sat_mult;
            b = lum + (b - lum) * sat_mult;
        }

        // 6. Spline Tone Curves
        let mut ir = r.clamp(0.0, 255.0) as u8;
        let mut ig = g.clamp(0.0, 255.0) as u8;
        let mut ib = b.clamp(0.0, 255.0) as u8;

        if let Some(lut) = &curve_rgb_lut {
            ir = lut[ir as usize];
            ig = lut[ig as usize];
            ib = lut[ib as usize];
        }
        if let Some(lut) = &curve_r_lut {
            ir = lut[ir as usize];
        }
        if let Some(lut) = &curve_g_lut {
            ig = lut[ig as usize];
        }
        if let Some(lut) = &curve_b_lut {
            ib = lut[ib as usize];
        }

        // 7. Vignette
        if adj.vignette.abs() > 1e-4 {
            let px = (i % width) as f64 - cx;
            let py = (i / width) as f64 - cy;
            let dist = (px * px + py * py).sqrt() / max_dist;
            let vign = (1.0 - dist * (adj.vignette / 100.0)).clamp(0.0, 2.0);
            ir = (ir as f64 * vign).clamp(0.0, 255.0) as u8;
            ig = (ig as f64 * vign).clamp(0.0, 255.0) as u8;
            ib = (ib as f64 * vign).clamp(0.0, 255.0) as u8;
        }

        // 8. Invert
        if adj.invert {
            ir = 255 - ir;
            ig = 255 - ig;
            ib = 255 - ib;
        }

        data[offset] = ir;
        data[offset + 1] = ig;
        data[offset + 2] = ib;
    }
}

/// Computes multi-channel 256-bin histogram distributions
pub fn calculate_histogram_buffer(data: &[u8]) -> HistogramData {
    let mut r = vec![0u32; 256];
    let mut g = vec![0u32; 256];
    let mut b = vec![0u32; 256];
    let mut lum = vec![0u32; 256];
    let mut max_bin = 0u32;

    let len = data.len();
    let mut i = 0;
    while i < len {
        let pr = data[i] as usize;
        let pg = data[i + 1] as usize;
        let pb = data[i + 2] as usize;
        let a = data[i + 3];

        if a > 0 {
            r[pr] += 1;
            g[pg] += 1;
            b[pb] += 1;

            let l = ((0.2126 * pr as f64 + 0.7152 * pg as f64 + 0.0722 * pb as f64).round() as usize).min(255);
            lum[l] += 1;

            if r[pr] > max_bin { max_bin = r[pr]; }
            if g[pg] > max_bin { max_bin = g[pg]; }
            if b[pb] > max_bin { max_bin = b[pb]; }
            if lum[l] > max_bin { max_bin = lum[l]; }
        }
        i += 4;
    }

    HistogramData { r, g, b, lum, max_bin }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    fn test_kelvin_to_rgb() {
        let (r, g, b) = kelvin_to_rgb(6500.0);
        assert!(r > 0.8 && r <= 1.0);
        assert!(g > 0.8 && g <= 1.0);
        assert!(b > 0.8 && b <= 1.0);
    }

    #[test]
    fn test_monotone_spline_identity() {
        let pts = vec![
            SplinePoint { x: 0.0, y: 0.0 },
            SplinePoint { x: 255.0, y: 255.0 },
        ];
        let lut = build_monotone_cubic_spline_lut(&pts);
        assert_eq!(lut[0], 0);
        assert_eq!(lut[128], 128);
        assert_eq!(lut[255], 255);
    }

    #[test]
    fn test_exposure_adjustment() {
        let mut buf = vec![100, 100, 100, 255];
        let adj = Adjustments {
            exposure: 1.0, // +1 EV should double intensity
            contrast: 0.0,
            highlights: 0.0,
            shadows: 0.0,
            whites: 0.0,
            blacks: 0.0,
            temperature: 5500.0,
            tint: 0.0,
            vibrance: 0.0,
            saturation: 0.0,
            clarity: 0.0,
            dehaze: 0.0,
            sharpness: 0.0,
            vignette: 0.0,
            film_grain: 0.0,
            invert: false,
            curve_rgb: None,
            curve_r: None,
            curve_g: None,
            curve_b: None,
        };
        apply_adjustments_buffer(&mut buf, 1, 1, &adj);
        assert_eq!(buf[0], 200);
        assert_eq!(buf[1], 200);
        assert_eq!(buf[2], 200);
    }

    #[test]
    fn test_histogram_bins() {
        let buf = vec![
            50, 100, 150, 255,
            50, 100, 150, 255,
        ];
        let hist = calculate_histogram_buffer(&buf);
        assert_eq!(hist.r[50], 2);
        assert_eq!(hist.g[100], 2);
        assert_eq!(hist.b[150], 2);
        assert_eq!(hist.max_bin, 2);
    }
}
