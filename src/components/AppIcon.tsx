/** One asset shared by app branding, the preview favicon and desktop packages. */
export default function AppIcon({
  size,
  className = "",
}: {
  size: number;
  className?: string;
}) {
  return (
    <img
      className={`app-icon ${className}`}
      src={`${import.meta.env.BASE_URL}app-icon.png`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
