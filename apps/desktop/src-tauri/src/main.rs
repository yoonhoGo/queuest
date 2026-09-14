// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() == Some("--cli") {
        std::process::exit(queuest_lib::run_cli(args));
    }
    queuest_lib::run()
}
