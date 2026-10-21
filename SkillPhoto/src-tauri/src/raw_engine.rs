use crate::models::RawSettings;
use crate::image_engine::kelvin_to_rgb;

/// Develops RAW sensor negative with 14-stop dynamic range recovery
pub fn develop_raw_buffer(data: &mut [u8], width: usize, height: usize, settings: &RawSettings) {
    let (wb_r, wb_g, wb_b) = kelvin_to_rgb(settings.temperature);
    let exp_mult = 2.0f64.powf(settings.exposure);
    let hl_rec = settings.highlight_recovery / 100.0;
    let sh_boost = settings.shadow_boost / 100.0;

    let cx = width as f64 / 2.0;
    let cy = height as f64 / 2.0;
    let max_dist = (cx * cx + cy * cy).sqrt();

    let num_pixels = width * height;
    for i in 0..num_pixels {
        let idx = i * 4;
        let mut r = data[idx] as f64 * exp_mult * wb_r;
        let mut g = data[idx + 1] as f64 * exp_mult * wb_g;
        let mut b = data[idx + 2] as f64 * exp_mult * wb_b;

        // 14-stop highlight recovery compression
        if hl_rec > 0.0 {
            if r > 200.0 {
                let over = r - 200.0;
                r = 200.0 + over * (1.0 - hl_rec * 0.7);
            }
            if g > 200.0 {
                let over = g - 200.0;
                g = 200.0 + over * (1.0 - hl_rec * 0.7);
            }
            if b > 200.0 {
                let over = b - 200.0;
                b = 200.0 + over * (1.0 - hl_rec * 0.7);
            }
        }

        // Shadow lift
        if sh_boost > 0.0 {
            let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            if lum < 80.0 {
                let lift = (1.0 - lum / 80.0) * sh_boost * 40.0;
                r += lift;
                g += lift;
                b += lift;
            }
        }

        // Camera Profile Tone Mapping
        match settings.camera_profile.as_str() {
            "Vivid" => {
                let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                r = lum + (r - lum) * 1.35;
                g = lum + (g - lum) * 1.35;
                b = lum + (b - lum) * 1.35;
            }
            "Portrait" => {
                r *= 1.05;
                g *= 1.01;
            }
            "Landscape" => {
                b *= 1.1;
                g *= 1.05;
            }
            "Flat" | "Neutral" => {
                r = r * 0.9 + 12.0;
                g = g * 0.9 + 12.0;
                b = b * 0.9 + 12.0;
            }
            _ => {}
        }

        // Lens Vignette Correction
        if settings.lens_vignette.abs() > 1e-4 {
            let px = (i % width) as f64 - cx;
            let py = (i / width) as f64 - cy;
            let dist = (px * px + py * py).sqrt() / max_dist;
            let vign = 1.0 + (dist * (settings.lens_vignette / 100.0) * 0.5);
            r *= vign;
            g *= vign;
            b *= vign;
        }

        data[idx] = r.clamp(0.0, 255.0).round() as u8;
        data[idx + 1] = g.clamp(0.0, 255.0).round() as u8;
        data[idx + 2] = b.clamp(0.0, 255.0).round() as u8;
    }
}
