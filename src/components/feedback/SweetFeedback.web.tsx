import { useEffect, useRef } from "react";
import Swal, { type SweetAlertIcon } from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import { Colors } from "@/src/styles/colors";

export type SweetFeedbackType = "success" | "error" | "warning" | "info";

type SweetFeedbackProps = {
  visible: boolean;
  type?: SweetFeedbackType;
  title: string;
  message?: string;
  confirmText?: string;
  autoDismissMs?: number;
  onClose: () => void;
};

const ICONS: Record<SweetFeedbackType, SweetAlertIcon> = {
  success: "success",
  error: "error",
  warning: "warning",
  info: "info",
};

const COLORS: Record<SweetFeedbackType, string> = {
  success: Colors.success,
  error: Colors.error,
  warning: Colors.accent,
  info: Colors.accentBlue,
};

export function SweetFeedback({
  visible,
  type = "success",
  title,
  message,
  confirmText = "OK",
  autoDismissMs,
  onClose,
}: SweetFeedbackProps) {
  const closeRef = useRef(onClose);
  const openIdRef = useRef(0);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!visible) {
      Swal.close();
      return;
    }

    let active = true;
    const openId = openIdRef.current + 1;
    openIdRef.current = openId;
    const tone = COLORS[type];

    Swal.fire({
      title,
      text: message || undefined,
      icon: ICONS[type],
      iconColor: tone,
      background: Colors.secondary,
      color: Colors.text,
      confirmButtonText: confirmText,
      confirmButtonColor: tone,
      timer: autoDismissMs,
      timerProgressBar: !!autoDismissMs,
      showConfirmButton: !autoDismissMs,
      allowOutsideClick: !autoDismissMs,
      allowEscapeKey: !autoDismissMs,
      heightAuto: false,
      showClass: {
        popup: "swal2-show",
        backdrop: "swal2-backdrop-show",
      },
      hideClass: {
        popup: "swal2-hide",
        backdrop: "swal2-backdrop-hide",
      },
      didOpen: () => {
        const popup = Swal.getPopup();
        if (popup) {
          popup.style.border = `1px solid ${tone}`;
          popup.style.borderRadius = "22px";
          popup.style.boxShadow = `0 0 28px ${tone}33`;
          popup.style.padding = "28px 24px 24px";
        }

        const confirmButton = Swal.getConfirmButton();
        if (confirmButton) {
          confirmButton.style.borderRadius = "16px";
          confirmButton.style.color =
            type === "success" || type === "warning"
              ? Colors.textOnAccent
              : Colors.white;
          confirmButton.style.fontWeight = "900";
          confirmButton.style.padding = "12px 26px";
          confirmButton.style.boxShadow = "none";
        }

        const progress = Swal.getTimerProgressBar();
        if (progress) progress.style.backgroundColor = tone;
      },
    }).then(() => {
      if (active && openIdRef.current === openId) {
        closeRef.current();
      }
    });

    return () => {
      active = false;
      if (openIdRef.current === openId) Swal.close();
    };
  }, [autoDismissMs, confirmText, message, title, type, visible]);

  return null;
}
