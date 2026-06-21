import { cn } from "@/lib/utils";

export function FilterPill({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 px-3 rounded-md text-sm border transition",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background border-border hover:bg-accent/40",
        className,
      )}
    >
      {children}
    </button>
  );
}
