# Queuest desktop design

## 1. Identity
Compact Korean quest notebook in a menu bar popover. Preserve the existing paper texture, square controls, mono captions, and teal actions.

## 2. Color
Existing App.css tokens are the source: ink #2d2a25, ink-soft #6e665b, paper #f3ecdc, paper-bright #fffdf5, paper-cream #fff8e9, paper-deep #e5dac5, teal #176b68, gold #f4d98b, rust #d88955, error #a85c3a, muted #887e6f, muted-light #a59a89.

## 3. Typography
Space Grotesk with Apple SD Gothic Neo for Korean; DM Mono for captions. Existing form inputs use 11px, labels 9px. Reuse existing heading, field-hint and validation-note classes. Keep Korean words together; long filesystem paths may wrap anywhere in previews.

## 4. Layout
Native window is 420px wide, at most 640px high. Header/navigation remain fixed; main-content owns vertical scrolling. Forms are one column with existing 7px gaps, 34px minimum inputs, 7px × 9px input padding. Action rows wrap. New folder/source groups inherit this form spacing.

## 5. Components
Reuse project-create-form, editor-panel, primary-button, secondary-button, form-actions, field-hint and validation-note. DirectoryField owns labelled path input plus native folder chooser and clear action. ProjectCreateForm offers existing folder or Git clone via native radio controls. Clone exposes repository address, parent folder and new directory name; the submit action clones then opens the project. Busy controls prevent duplicate operations; errors remain near the form; cancelling a chooser preserves its previous value.

## 6. Motion
No new animation. Native dialog and existing button state feedback suffice. Respect existing reduced-motion styles.

## 7. Depth
Existing paper surface and dark borders; preserve current button shadows and square corners. New groups add no independent elevation.

## 8. Accessibility and scope
Every field has a label; native radios support keyboard selection. Errors use role=alert, progress uses role=status. Focus returns from the native chooser. Long paths must not widen the window. Existing unrelated styling inconsistencies are outside this feature; no new accessibility debt is introduced intentionally.
