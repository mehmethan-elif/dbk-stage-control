import type { ReactNode } from "react";

export function StageDialog(props: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="dialog-backdrop" onClick={props.onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="dialog-title">{props.title}</h3>
        {props.children}
      </div>
    </div>
  );
}
