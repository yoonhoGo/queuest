import { useId, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface DirectoryFieldProps {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (path: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function DirectoryField({ label, value, disabled, onChange, onBusyChange }: DirectoryFieldProps) {
  const id = useId();
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function chooseDirectory() {
    setChoosing(true);
    onBusyChange?.(true);
    setError(null);
    try {
      const path = await invoke<string | null>("choose_project_directory", { title: label });
      if (path !== null) onChange(path);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "폴더를 선택하지 못했습니다.");
    } finally {
      setChoosing(false);
      onBusyChange?.(false);
    }
  }

  return (
    <div className="directory-field">
      <label htmlFor={id}>{label}</label>
      <div className="form-actions">
        <button type="button" className="secondary-button" disabled={disabled || choosing} onClick={() => void chooseDirectory()}>
          {choosing ? "폴더 선택 중…" : "폴더 선택…"}
        </button>
        {value && <button type="button" className="row-action" disabled={disabled || choosing} onClick={() => onChange("")}>연결 해제</button>}
      </div>
      <input id={id} type="text" value={value} disabled={disabled || choosing}
        placeholder="폴더를 선택하거나 경로를 입력하세요" onChange={(event) => onChange(event.target.value)} />
      {error && <p className="validation-note" role="alert">{error}</p>}
    </div>
  );
}
