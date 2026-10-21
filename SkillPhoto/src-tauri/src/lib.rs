pub mod models;
pub mod image_engine;
pub mod compositor;
pub mod ai_engine;
pub mod raw_engine;
pub mod project_io;
pub mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::get_system_info,
            commands::save_to_downloads,
            commands::process_adjustments,
            commands::calculate_histogram,
            commands::composite_layers,
            commands::ai_remove_background,
            commands::ai_smooth_skin,
            commands::ai_enhance_details,
            commands::auto_tone_image,
            commands::develop_raw,
            commands::execute_batch_queue,
            commands::save_project_file,
            commands::load_project_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
