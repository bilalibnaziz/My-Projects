use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};

use crate::models::{Adjustments, BatchItem, HistogramData, RawSettings};
use crate::image_engine::{apply_adjustments_buffer, calculate_histogram_buffer};
use crate::compositor::composite_two_layers;
use crate::ai_engine::{ai_remove_background_buffer, ai_smooth_skin_buffer, ai_enhance_details_buffer, auto_tone_buffer};
use crate::raw_engine::develop_raw_buffer;
use crate::project_io::{save_project_file_atomic, load_project_file as read_proj, execute_batch_item};

#[derive(Serialize, Deserialize)]
pub struct SystemInfo {
    pub engine: String,
    pub version: String,
    pub os: String,
    pub arch: String,
}

#[tauri::command]
pub fn get_system_info() -> SystemInfo {
    SystemInfo {
        engine: "Skill Photo Native Rust Accelerated Engine".into(),
        version: "2.0.0".into(),
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
    }
}

#[tauri::command]
pub fn save_to_downloads(filename: String, data_base64: String) -> Result<String, String> {
    let bytes = BASE64.decode(&data_base64).map_err(|e| e.to_string())?;
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Cannot locate home directory".to_string())?;
    let dir = std::path::Path::new(&home).join("Downloads");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = filename
        .chars()
        .map(|c| if c == '/' || c == '\\' || c == ':' { '_' } else { c })
        .collect();
    let path = std::path::Path::new(&safe);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("export").to_string();
    let ext = path.extension().and_then(|s| s.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
    let mut target = dir.join(&safe);
    let mut n = 1;
    while target.exists() {
        target = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn process_adjustments(
    data_base64: String,
    width: u32,
    height: u32,
    adjustments: Adjustments,
) -> Result<String, String> {
    let mut bytes = BASE64.decode(&data_base64).map_err(|e| e.to_string())?;
    apply_adjustments_buffer(&mut bytes, width as usize, height as usize, &adjustments);
    Ok(BASE64.encode(&bytes))
}

#[tauri::command]
pub fn calculate_histogram(data_base64: String) -> Result<HistogramData, String> {
    let bytes = BASE64.decode(&data_base64).map_err(|e| e.to_string())?;
    Ok(calculate_histogram_buffer(&bytes))
}

#[tauri::command]
pub fn composite_layers(
    bottom_base64: String,
    top_base64: String,
    width: u32,
    height: u32,
    opacity: f64,
    blend_mode: String,
) -> Result<String, String> {
    let mut bot_bytes = BASE64.decode(&bottom_base64).map_err(|e| e.to_string())?;
    let top_bytes = BASE64.decode(&top_base64).map_err(|e| e.to_string())?;
    composite_two_layers(&mut bot_bytes, &top_bytes, width as usize, height as usize, opacity, &blend_mode);
    Ok(BASE64.encode(&bot_bytes))
}

#[tauri::command]
pub fn ai_remove_background(data_base64: String, width: u32, height: u32, tolerance: f64) -> Result<String, String> {
    let mut bytes = BASE64.decode(&data_base64).map_err(|e| e.to_string())?;
    ai_remove_background_buffer(&mut bytes, width as usize, height as usize, tolerance);
    Ok(BASE64.encode(&bytes))
}

#[tauri::command]
pub fn ai_smooth_skin(data_base64: String, width: u32, height: u32, strength: f64) -> Result<String, String> {
    let mut bytes = BASE64.decode(&data_base64).map_err(|e| e.to_string())?;
    ai_smooth_skin_buffer(&mut bytes, width as usize, height as usize, strength);
    Ok(BASE64.encode(&bytes))
}

#[tauri::command]
pub fn ai_enhance_details(data_base64: String, width: u32, height: u32, amount: f64) -> Result<String, String> {
    let mut bytes = BASE64.decode(&data_base64).map_err(|e| e.to_string())?;
    ai_enhance_details_buffer(&mut bytes, width as usize, height as usize, amount);
    Ok(BASE64.encode(&bytes))
}

#[tauri::command]
pub fn auto_tone_image(data_base64: String, width: u32, height: u32) -> Result<String, String> {
    let mut bytes = BASE64.decode(&data_base64).map_err(|e| e.to_string())?;
    auto_tone_buffer(&mut bytes, width as usize, height as usize);
    Ok(BASE64.encode(&bytes))
}

#[tauri::command]
pub fn develop_raw(data_base64: String, width: u32, height: u32, settings: RawSettings) -> Result<String, String> {
    let mut bytes = BASE64.decode(&data_base64).map_err(|e| e.to_string())?;
    develop_raw_buffer(&mut bytes, width as usize, height as usize, &settings);
    Ok(BASE64.encode(&bytes))
}

#[tauri::command]
pub fn execute_batch_queue(items: Vec<BatchItem>) -> Result<Vec<String>, String> {
    let mut results = Vec::with_capacity(items.len());
    for item in items {
        results.push(execute_batch_item(&item)?);
    }
    Ok(results)
}

#[tauri::command]
pub fn save_project_file(path: String, content: String) -> Result<(), String> {
    save_project_file_atomic(&path, &content)
}

#[tauri::command]
pub fn load_project_file(path: String) -> Result<String, String> {
    read_proj(&path)
}
