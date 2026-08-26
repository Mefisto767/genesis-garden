interface ToastProps {
  text: string;
}

export function Toast({ text }: ToastProps) {
  return <div className="toast">{text}</div>;
}
