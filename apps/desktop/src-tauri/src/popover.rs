//! macOS screen coordinates are points, not a single global physical-pixel grid.
//! Read the status item's own screen rather than guessing it from a scaled point.
use objc2::MainThreadMarker;
use objc2_app_kit::NSScreen;
use tauri::{Manager, WebviewWindow};

#[derive(Clone, Copy, Debug, PartialEq)]
struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

// Calculate in top-down points relative to the primary screen, then convert
// back to AppKit points before applying the frame. No physical pixels involved.
fn top_down(frame: Bounds, primary_top: f64) -> Bounds {
    Bounds {
        y: primary_top - frame.y - frame.height,
        ..frame
    }
}

fn layout(icon: Bounds, work_area: Bounds) -> Bounds {
    let width = 420.0_f64.min(work_area.width);
    let y = (icon.y + icon.height + 6.0).max(work_area.y);
    Bounds {
        x: (icon.x + icon.width / 2.0 - width / 2.0).clamp(
            work_area.x,
            (work_area.x + work_area.width - width).max(work_area.x),
        ),
        y,
        width,
        height: 640.0_f64.min((work_area.y + work_area.height - y).max(1.0)),
    }
}

pub(super) fn position(window: &WebviewWindow) -> Result<(), String> {
    let tray = window
        .app_handle()
        .tray_by_id("queuest")
        .ok_or("메뉴바 아이콘이 없습니다.")?;
    // with_inner_tray_icon dispatches to the main thread, as required by AppKit.
    let window = window.clone();
    tray.with_inner_tray_icon(move |tray| {
        let mtm = MainThreadMarker::new()?;
        let status = tray.ns_status_item()?;
        let tray_window = status.button(mtm)?.window()?;
        let frame = tray_window.frame();
        let visible = tray_window.screen()?.visibleFrame();
        let primary = NSScreen::screens(mtm).firstObject()?.frame();
        let primary_top = primary.origin.y + primary.size.height;
        let placement = layout(
            top_down(
                Bounds {
                    x: frame.origin.x,
                    y: frame.origin.y,
                    width: frame.size.width,
                    height: frame.size.height,
                },
                primary_top,
            ),
            top_down(
                Bounds {
                    x: visible.origin.x,
                    y: visible.origin.y,
                    width: visible.size.width,
                    height: visible.size.height,
                },
                primary_top,
            ),
        );
        let pointer = window.ns_window().ok()?;
        // SAFETY: Tauri owns this NSWindow and the cloned WebviewWindow
        // stays alive throughout this main-thread callback. Never retain
        // the borrowed pointer or send it to another thread.
        let native_window = unsafe { pointer.cast::<objc2_app_kit::NSWindow>().as_ref()? };
        let mut target = native_window.frame();
        target.origin.x = placement.x;
        target.origin.y = primary_top - placement.y - placement.height;
        target.size.width = placement.width;
        target.size.height = placement.height;
        // Use AppKit end to end: Tao's physical position conversion uses
        // the old window's scale and is ambiguous across mixed-DPI screens.
        native_window.setFrame_display(target, false);
        #[cfg(debug_assertions)]
        eprintln!(
            "[popover] icon={frame:?} target={target:?} actual={:?}",
            native_window.frame()
        );
        Some(())
    })
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "메뉴바의 화면 영역을 읽지 못했습니다.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primary_menu_bar_uses_points_without_retina_multiplication() {
        let icon = top_down(
            Bounds {
                x: 1200.0,
                y: 876.0,
                width: 40.0,
                height: 24.0,
            },
            900.0,
        );
        let area = top_down(
            Bounds {
                x: 0.0,
                y: 0.0,
                width: 1440.0,
                height: 876.0,
            },
            900.0,
        );
        assert_eq!(
            layout(icon, area),
            Bounds {
                x: 1010.0,
                y: 30.0,
                width: 420.0,
                height: 640.0
            }
        );
    }

    #[test]
    fn secondary_screen_to_the_left_and_above_keeps_negative_coordinates() {
        let icon = top_down(
            Bounds {
                x: -100.0,
                y: 1200.0,
                width: 40.0,
                height: 24.0,
            },
            900.0,
        );
        let area = top_down(
            Bounds {
                x: -1920.0,
                y: 144.0,
                width: 1920.0,
                height: 1056.0,
            },
            900.0,
        );
        assert_eq!(
            layout(icon, area),
            Bounds {
                x: -420.0,
                y: -294.0,
                width: 420.0,
                height: 640.0
            }
        );
    }

    #[test]
    fn right_hand_external_screen_does_not_use_previous_windows_scale() {
        let icon = Bounds {
            x: 3280.0,
            y: 0.0,
            width: 40.0,
            height: 24.0,
        };
        let area = Bounds {
            x: 1440.0,
            y: 24.0,
            width: 1920.0,
            height: 1056.0,
        };
        assert_eq!(layout(icon, area).x, 2940.0);
    }

    #[test]
    fn short_screen_clamps_left_edge_and_keeps_bottom_visible() {
        let icon = Bounds {
            x: 0.0,
            y: 0.0,
            width: 40.0,
            height: 24.0,
        };
        let area = Bounds {
            x: 0.0,
            y: 24.0,
            width: 1024.0,
            height: 576.0,
        };
        assert_eq!(
            layout(icon, area),
            Bounds {
                x: 0.0,
                y: 30.0,
                width: 420.0,
                height: 570.0
            }
        );
    }
}
