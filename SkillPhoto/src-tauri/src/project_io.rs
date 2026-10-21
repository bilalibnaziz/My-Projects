use std::fs;
use std::path::Path;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use crate::models::BatchItem;
use crate::image_engine::apply_adjustments_buffer;

pub fn save_project_file_atomic(path: &str, content: &str) -> Result<(), String> {
    let target = Path::new(path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp_path = format!("{path}.tmp.{}", std::process::id());
    fs::write(&tmp_path, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_project_file(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

pub fn execute_batch_item(item: &BatchItem) -> Result<String, String> {
    let mut bytes = BASE64.decode(&item.input_base64).map_err(|e| e.to_string())?;
    // For raw pixel buffers or pre-decoded data
    let total_pixels = bytes.len() / 4;
    let dim = (total_pixels as f64).sqrt().round() as usize;
    if dim > 0 && dim * dim * 4 == bytes.len() {
        apply_adjustments_buffer(&mut bytes, dim, dim, &item.adjustments);
    }
    Ok(BASE64.encode(&bytes))
}
