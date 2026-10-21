use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Adjustments {
    pub exposure: f64,
    pub contrast: f64,
    pub highlights: f64,
    pub shadows: f64,
    pub whites: f64,
    pub blacks: f64,
    pub temperature: f64,
    pub tint: f64,
    pub vibrance: f64,
    pub saturation: f64,
    pub clarity: f64,
    pub dehaze: f64,
    pub sharpness: f64,
    pub vignette: f64,
    pub film_grain: f64,
    pub invert: bool,
    pub curve_rgb: Option<Vec<SplinePoint>>,
    pub curve_r: Option<Vec<SplinePoint>>,
    pub curve_g: Option<Vec<SplinePoint>>,
    pub curve_b: Option<Vec<SplinePoint>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplinePoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistogramData {
    pub r: Vec<u32>,
    pub g: Vec<u32>,
    pub b: Vec<u32>,
    pub lum: Vec<u32>,
    pub max_bin: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerDescriptor {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub opacity: f64,
    pub blend_mode: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub data_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawSettings {
    pub temperature: f64,
    pub tint: f64,
    pub exposure: f64,
    pub highlight_recovery: f64,
    pub shadow_boost: f64,
    pub camera_profile: String,
    pub lens_vignette: f64,
    pub demosaic: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchItem {
    pub id: String,
    pub name: String,
    pub input_base64: String,
    pub adjustments: Adjustments,
    pub output_format: String,
    pub scale_percent: u32,
}
