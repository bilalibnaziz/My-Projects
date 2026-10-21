pub fn blend_channel(b: f64, s: f64, mode: &str) -> f64 {
    let cb = b / 255.0;
    let cs = s / 255.0;

    let res = match mode {
        "multiply" => cb * cs,
        "screen" => 1.0 - (1.0 - cb) * (1.0 - cs),
        "overlay" => {
            if cb <= 0.5 {
                2.0 * cb * cs
            } else {
                1.0 - 2.0 * (1.0 - cb) * (1.0 - cs)
            }
        }
        "darken" => cb.min(cs),
        "lighten" => cb.max(cs),
        "difference" => (cb - cs).abs(),
        "exclusion" => cb + cs - 2.0 * cb * cs,
        "color-dodge" => {
            if cs >= 1.0 { 1.0 } else { (cb / (1.0 - cs)).min(1.0) }
        }
        "color-burn" => {
            if cs <= 0.0 { 0.0 } else { (1.0 - (1.0 - cb) / cs).max(0.0) }
        }
        "hard-light" => {
            if cs <= 0.5 {
                2.0 * cb * cs
            } else {
                1.0 - 2.0 * (1.0 - cb) * (1.0 - cs)
            }
        }
        "soft-light" => {
            if cs <= 0.5 {
                cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb)
            } else {
                let d = if cb <= 0.25 {
                    ((16.0 * cb - 12.0) * cb + 4.0) * cb
                } else {
                    cb.sqrt()
                };
                cb + (2.0 * cs - 1.0) * (d - cb)
            }
        }
        _ => cs, // default normal
    };

    (res * 255.0).clamp(0.0, 255.0)
}

pub fn composite_two_layers(
    bottom: &mut [u8],
    top: &[u8],
    width: usize,
    height: usize,
    opacity: f64,
    blend_mode: &str,
) {
    let len = (width * height * 4).min(bottom.len()).min(top.len());
    let mut i = 0;
    while i < len {
        let ba = bottom[i + 3] as f64 / 255.0;
        let ta = (top[i + 3] as f64 / 255.0) * opacity;

        if ta <= 0.0 {
            i += 4;
            continue;
        }

        let out_a = ta + ba * (1.0 - ta);
        if out_a > 0.0 {
            for c in 0..3 {
                let b_val = bottom[i + c] as f64;
                let t_val = top[i + c] as f64;
                let blended = blend_channel(b_val, t_val, blend_mode);
                let out_val = (blended * ta + b_val * ba * (1.0 - ta)) / out_a;
                bottom[i + c] = out_val.round().clamp(0.0, 255.0) as u8;
            }
            bottom[i + 3] = (out_a * 255.0).round().clamp(0.0, 255.0) as u8;
        }

        i += 4;
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    fn test_blend_multiply() {
        let res = blend_channel(200.0, 100.0, "multiply");
        let expected = (200.0f64 * 100.0 / 255.0).round();
        assert!((res - expected).abs() <= 1.0);
    }

    #[test]
    fn test_blend_screen() {
        let res = blend_channel(128.0, 128.0, "screen");
        assert!(res > 128.0);
    }

    #[test]
    fn test_blend_difference() {
        let res = blend_channel(255.0, 100.0, "difference");
        assert_eq!(res.round(), 155.0);
    }

    #[test]
    fn test_blend_layers_opacity() {
        let mut bot = vec![0, 0, 0, 255];
        let top = vec![255, 255, 255, 255];
        composite_two_layers(&mut bot, &top, 1, 1, 0.5, "normal");
        assert_eq!(bot[0], 128);
        assert_eq!(bot[3], 255);
    }
}
