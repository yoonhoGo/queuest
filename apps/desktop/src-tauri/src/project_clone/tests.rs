use std::{fs, path::Path, process::Command};

use super::clone_repository;

#[test]
fn stops_a_stalled_git_process_when_timeout_expires() {
    // Given
    let child = Command::new("git")
        .args(["hash-object", "--stdin"])
        .stdin(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    // When
    let result = super::wait_for_clone(child, std::time::Duration::ZERO);
    // Then
    assert!(result.is_err());
}

fn source_repository(root: &Path) -> String {
    let source = root.join("source");
    let status = Command::new("git")
        .args(["init", "--quiet"])
        .arg(&source)
        .status()
        .unwrap();
    assert!(status.success());
    fs::write(source.join("README.md"), "project content\n").unwrap();
    assert!(Command::new("git")
        .args(["add", "README.md"])
        .current_dir(&source)
        .status()
        .unwrap()
        .success());
    assert!(Command::new("git")
        .args([
            "-c",
            "user.name=Queuest Test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--quiet",
            "-m",
            "initial",
        ])
        .current_dir(&source)
        .status()
        .unwrap()
        .success());
    source.to_str().unwrap().to_owned()
}

#[test]
fn clones_repository_into_selected_parent_when_destination_is_new() {
    // Given
    let root = tempfile::tempdir().unwrap();
    let source = source_repository(root.path());
    // When
    let path = clone_repository(&source, root.path().to_str().unwrap(), "한글 project").unwrap();
    // Then
    assert_eq!(
        fs::read_to_string(Path::new(&path).join("README.md")).unwrap(),
        "project content\n"
    );
    assert!(Path::new(&path).join(".git").is_dir());
}

#[test]
fn preserves_existing_destination_when_clone_is_requested() {
    // Given
    let root = tempfile::tempdir().unwrap();
    let source = source_repository(root.path());
    let destination = root.path().join("existing");
    fs::create_dir(&destination).unwrap();
    fs::write(destination.join("keep.txt"), "keep").unwrap();
    // When
    let result = clone_repository(&source, root.path().to_str().unwrap(), "existing");
    // Then
    assert!(result.is_err());
    assert_eq!(
        fs::read_to_string(destination.join("keep.txt")).unwrap(),
        "keep"
    );
}

#[test]
fn rejects_unsafe_inputs_before_creating_a_destination() {
    // Given
    let root = tempfile::tempdir().unwrap();
    let parent = root.path().to_str().unwrap();
    // When / Then
    for remote in [
        "",
        "-ufoo",
        "ext::touch bad",
        "http://example.com/repo",
        "relative/repo",
    ] {
        assert!(clone_repository(remote, parent, "target").is_err());
    }
    for child in [
        "",
        ".",
        "..",
        "../outside",
        "/absolute",
        "nested/child",
        "back\\slash",
        "-option",
    ] {
        assert!(clone_repository("https://example.com/repo.git", parent, child).is_err());
    }
    assert!(!root.path().join("target").exists());
}

#[test]
fn returns_error_when_selected_parent_is_missing() {
    // Given
    let root = tempfile::tempdir().unwrap();
    let missing = root.path().join("missing");
    // When
    let result = clone_repository(
        "https://example.com/repo.git",
        missing.to_str().unwrap(),
        "target",
    );
    // Then
    assert!(result.is_err());
    assert!(!missing.exists());
}

#[test]
fn reports_failed_clone_without_leaving_an_empty_destination() {
    // Given
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("missing-repository");
    // When
    let result = clone_repository(
        source.to_str().unwrap(),
        root.path().to_str().unwrap(),
        "target",
    );
    // Then
    assert!(result.is_err());
    assert!(!root.path().join("target").exists());
}

#[test]
fn removes_partial_clone_when_source_tree_is_missing() {
    let root = tempfile::tempdir().unwrap();
    let source = source_repository(root.path());
    let output = Command::new("git")
        .args(["rev-parse", "HEAD^{tree}"])
        .current_dir(&source)
        .output()
        .unwrap();
    assert!(output.status.success());
    let tree = String::from_utf8(output.stdout).unwrap();
    let (prefix, suffix) = tree.trim().split_at(2);
    fs::remove_file(
        Path::new(&source)
            .join(".git/objects")
            .join(prefix)
            .join(suffix),
    )
    .unwrap();

    let result = clone_repository(&source, root.path().to_str().unwrap(), "target");

    assert!(result.is_err());
    assert!(!root.path().join("target").exists());
}
