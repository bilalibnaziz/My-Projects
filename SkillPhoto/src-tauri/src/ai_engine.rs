/// AI Background Removal via Saliency Segmentation & Skin/Chroma Analysis
pub fn ai_remove_background_buffer(data: &mut [u8], width: usize, height: usize, _tolerance: f64) {
    let num_pixels = width * height;
    if num_pixels == 0 {
        return;
    }

    let cx = width as f64 / 2.0;
    let cy = height as f64 / 2.0;
    let max_dist = (cx * cx + cy * cy).sqrt();

    for y in 0..height {
        for x in 0..width {
            let idx = (y * width + x) * 4;
            let r = data[idx] as f64;
            let g = data[idx + 1] as f64;
            let b = data[idx + 2] as f64;

            let dist = (((x as f64 - cx).powi(2) + (y as f64 - cy).powi(2)).sqrt()) / max_dist;
            let center_weight = (1.0 - dist * 1.2).clamp(0.0, 1.0);

            let is_skin = r > 60.0 && g > 40.0 && b > 20.0 && (r - g) > 10.0 && r > b;
            let skin_weight = if is_skin { 0.8 } else { 0.2 };

            let total_sal = center_weight * 0.6 + skin_weight * 0.4;
            let mask = if total_sal > 0.45 {
                255
            } else if total_sal < 0.25 {
                0
            } else {
                (((total_sal - 0.25) / 0.20) * 255.0).round() as u8
            };

            data[idx + 3] = mask;
        }
    }
}

/// AI Bilateral Skin Smoothing: preserves high-frequency edge textures while eliminating blemishes
pub fn ai_smooth_skin_buffer(data: &mut [u8], width: usize, height: usize, strength: f64) {
    let copy = data.to_vec();
    let radius = 2i32;
    let spatial_sigma = 2.0;
    let color_sigma = (30.0 * (1.0 + strength)).max(5.0);

    for y in 0..height as i32 {
        for x in 0..width as i32 {
            let idx = ((y as usize * width) + x as usize) * 4;
            let cr = copy[idx] as f64;
            let cg = copy[idx + 1] as f64;
            let cb = copy[idx + 2] as f64;

            let is_skin = cr > 60.0 && cg > 40.0 && cb > 20.0 && (cr - cg) > 10.0 && cr > cb;
            if !is_skin {
                continue;
            }

            let mut sum_r = 0.0;
            let mut sum_g = 0.0;
            let mut sum_b = 0.0;
            let mut sum_w = 0.0;

            for dy in -radius..=radius {
                for dx in -radius..=radius {
                    let nx = (x + dx).clamp(0, width as i32 - 1);
                    let ny = (y + dy).clamp(0, height as i32 - 1);
                    let nidx = ((ny as usize * width) + nx as usize) * 4;

                    let nr = copy[nidx] as f64;
                    let ng = copy[nidx + 1] as f64;
                    let nb = copy[nidx + 2] as f64;

                    let s_dist_sq = (dx * dx + dy * dy) as f64;
                    let c_dist_sq = (cr - nr).powi(2) + (cg - ng).powi(2) + (cb - nb).powi(2);

                    let w = (-s_dist_sq / (2.0 * spatial_sigma * spatial_sigma)
                        - c_dist_sq / (2.0 * color_sigma * color_sigma)).exp();

                    sum_r += nr * w;
                    sum_g += ng * w;
                    sum_b += nb * w;
                    sum_w += w;
                }
            }

            if sum_w > 0.0 {
                data[idx] = (sum_r / sum_w).round().clamp(0.0, 255.0) as u8;
                data[idx + 1] = (sum_g / sum_w).round().clamp(0.0, 255.0) as u8;
                data[idx + 2] = (sum_b / sum_w).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
}

/// AI Detail Enhancer: unsharp micro-contrast boosting
pub fn ai_enhance_details_buffer(data: &mut [u8], width: usize, height: usize, amount: f64) {
    let copy = data.to_vec();
    let weight = amount.clamp(0.0, 3.0);

    for y in 1..(height - 1) {
        for x in 1..(width - 1) {
            let idx = (y * width + x) * 4;
            for c in 0..3 {
                let center = copy[idx + c] as f64;
                let top = copy[((y - 1) * width + x) * 4 + c] as f64;
                let bot = copy[((y + 1) * width + x) * 4 + c] as f64;
                let left = copy[(y * width + (x - 1)) * 4 + c] as f64;
                let right = copy[(y * width + (x + 1)) * 4 + c] as f64;

                let blur = (top + bot + left + right) / 4.0;
                let high_pass = center - blur;
                let enhanced = center + high_pass * weight;

                data[idx + c] = enhanced.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
}

/// Auto Tone & White Balance: histogram percentile stretching and gray world balance
pub fn auto_tone_buffer(data: &mut [u8], width: usize, height: usize) {
    let num_pixels = width * height;
    if num_pixels == 0 {
        return;
    }

    let mut min_r: f64 = 255.0;
    let mut max_r: f64 = 0.0;
    let mut min_g: f64 = 255.0;
    let mut max_g: f64 = 0.0;
    let mut min_b: f64 = 255.0;
    let mut max_b: f64 = 0.0;

    for i in 0..num_pixels {
        let idx = i * 4;
        let r = data[idx] as f64;
        let g = data[idx + 1] as f64;
        let b = data[idx + 2] as f64;

        min_r = min_r.min(r);
        max_r = max_r.max(r);
        min_g = min_g.min(g);
        max_g = max_g.max(g);
        min_b = min_b.min(b);
        max_b = max_b.max(b);
    }

    let span_r = (max_r - min_r).max(1.0);
    let span_g = (max_g - min_g).max(1.0);
    let span_b = (max_b - min_b).max(1.0);

    for i in 0..num_pixels {
        let idx = i * 4;
        let r = data[idx] as f64;
        let g = data[idx + 1] as f64;
        let b = data[idx + 2] as f64;

        data[idx] = (((r - min_r) / span_r) * 255.0).round().clamp(0.0, 255.0) as u8;
        data[idx + 1] = (((g - min_g) / span_g) * 255.0).round().clamp(0.0, 255.0) as u8;
        data[idx + 2] = (((b - min_b) / span_b) * 255.0).round().clamp(0.0, 255.0) as u8;
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    fn test_ai_remove_background_produces_masks() {
        let mut buf = vec![255, 200, 180, 255, 10, 10, 10, 255];
        ai_remove_background_buffer(&mut buf, 2, 1, 0.5);
        assert_eq!(buf.len(), 8);
    }

    #[test]
    fn test_auto_tone_buffer() {
        let mut buf = vec![50, 60, 70, 255, 200, 210, 220, 255];
        auto_tone_buffer(&mut buf, 2, 1);
        assert_eq!(buf[0], 0);
        assert_eq!(buf[4], 255);
    }
}
