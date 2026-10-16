export const CROPPER_ACCENT = `
@layer components {
:is(.asm-cropper, .asm-message-cropper) .cropper-view-box {
  outline: 2px solid #ff9500 !important;
  outline-color: #ff9500 !important;
  box-shadow:
    inset 0 0 0 1px rgba(255,255,255,0.22),
    0 0 0 1px rgba(230,85,0,0.9),
    0 2px 8px rgba(0,0,0,0.18) !important;
}
:is(.asm-cropper, .asm-message-cropper) .cropper-face {
  background-color: transparent !important;
  opacity: 1 !important;
}
:is(.asm-cropper, .asm-message-cropper) .cropper-modal {
  background-color: rgba(28, 18, 8, 0.62) !important;
  opacity: 1 !important;
}
:is(.asm-cropper, .asm-message-cropper) .cropper-line {
  background-color: #ff9500 !important;
  opacity: 1 !important;
}
:is(.asm-cropper, .asm-message-cropper) .cropper-line.line-n {
  top: 0 !important;
  left: 0 !important;
  width: 100% !important;
  height: 2px !important;
}
:is(.asm-cropper, .asm-message-cropper) .cropper-line.line-s {
  bottom: 0 !important;
  left: 0 !important;
  width: 100% !important;
  height: 2px !important;
  top: auto !important;
}
:is(.asm-cropper, .asm-message-cropper) .cropper-line.line-e {
  top: 0 !important;
  right: 0 !important;
  height: 100% !important;
  width: 2px !important;
  left: auto !important;
}
:is(.asm-cropper, .asm-message-cropper) .cropper-line.line-w {
  top: 0 !important;
  left: 0 !important;
  height: 100% !important;
  width: 2px !important;
  right: auto !important;
}

:is(.asm-cropper, .asm-message-cropper) .cropper-point {
  width: 10px !important;
  height: 10px !important;
  background-color: #fff !important;
  border: 2px solid #ff9500 !important;
  border-radius: 9999px !important;
  box-shadow:
    inset 0 1px 1px rgba(255,255,255,0.95),
    0 1px 4px rgba(0,0,0,0.28) !important;
  opacity: 1 !important;
}
:is(.asm-cropper, .asm-message-cropper) .cropper-point.point-n {
  top: 0 !important;
  left: 50% !important;
  right: auto !important;
  bottom: auto !important;
  margin-left: -5px !important;
  margin-top: -5px !important;
}
:is(.asm-cropper, .asm-message-cropper) .cropper-point.point-s {
  bottom: 0 !important;
  left: 50% !important;
  top: auto !important;
  right: auto !important;
  margin-left: -5px !important;
  margin-bottom: -5px !important;
  margin-top: 0 !important;
}
:is(.asm-cropper, .asm-message-cropper) .cropper-point.point-e {
  top: 50% !important;
  right: 0 !important;
  left: auto !important;
  bottom: auto !important;
  margin-top: -5px !important;
  margin-right: -5px !important;
}
:is(.asm-cropper, .asm-message-cropper) .cropper-point.point-w {
  top: 50% !important;
  left: 0 !important;
  right: auto !important;
  bottom: auto !important;
  margin-top: -5px !important;
  margin-left: -5px !important;
}
:is(.asm-cropper, .asm-message-cropper) .cropper-point.point-ne {
  top: 0 !important;
  right: 0 !important;
  left: auto !important;
  bottom: auto !important;
  margin-top: -5px !important;
  margin-right: -5px !important;
  margin-left: 0 !important;
}
:is(.asm-cropper, .asm-message-cropper) .cropper-point.point-nw {
  top: 0 !important;
  left: 0 !important;
  right: auto !important;
  bottom: auto !important;
  margin-top: -5px !important;
  margin-left: -5px !important;
}
:is(.asm-cropper, .asm-message-cropper) .cropper-point.point-se {
  bottom: 0 !important;
  right: 0 !important;
  left: auto !important;
  top: auto !important;
  margin-bottom: -5px !important;
  margin-right: -5px !important;
  margin-top: 0 !important;
  margin-left: 0 !important;
  width: 10px !important;
  height: 10px !important;
  opacity: 1 !important;
}
:is(.asm-cropper, .asm-message-cropper) .cropper-point.point-sw {
  bottom: 0 !important;
  left: 0 !important;
  right: auto !important;
  top: auto !important;
  margin-bottom: -5px !important;
  margin-left: -5px !important;
  margin-top: 0 !important;
}

@media (min-width: 768px) {
  :is(.asm-cropper, .asm-message-cropper) .cropper-point.point-se {
    width: 10px !important;
    height: 10px !important;
  }
}
@media (min-width: 992px) {
  :is(.asm-cropper, .asm-message-cropper) .cropper-point.point-se {
    width: 10px !important;
    height: 10px !important;
  }
}
@media (min-width: 1200px) {
  :is(.asm-cropper, .asm-message-cropper) .cropper-point.point-se {
    width: 10px !important;
    height: 10px !important;
    opacity: 1 !important;
  }
}
:is(.asm-cropper, .asm-message-cropper) .cropper-point.point-se::before {
  display: none !important;
}
:is(.asm-cropper, .asm-message-cropper) .cropper-center {
  display: none !important;
}
:is(.asm-cropper, .asm-message-cropper) .cropper-dashed {
  border-color: rgba(255,149,0,0.32) !important;
  opacity: 1 !important;
}
}
`;
