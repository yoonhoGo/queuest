import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

export function useWindowPin(onError: (message: string) => void) {
  const [pinned, setPinned] = useState(false);
  const [pinPending, setPinPending] = useState(isTauri);
  const busy = useRef(isTauri());

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    void invoke<boolean>("get_window_pinned").then((value) => {
      if (!active) return;
      setPinned(value);
    }).catch((error: unknown) => {
      if (active) onError(`창 고정 상태를 읽지 못했습니다: ${String(error)}`);
    }).finally(() => {
      if (!active) return;
      busy.current = false;
      setPinPending(false);
    });
    return () => { active = false; };
  }, [onError]);

  async function togglePinned(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPinPending(true);
    try {
      const currentPin = await invoke<boolean>("get_window_pinned");
      const value = await invoke<boolean>("set_window_pinned", {
        pinned: !currentPin,
      });
      setPinned(value);
    } catch (error: unknown) {
      onError(`창 고정 상태를 변경하지 못했습니다: ${String(error)}`);
    } finally {
      busy.current = false;
      setPinPending(false);
    }
  }

  return { pinned, pinPending, togglePinned };
}
