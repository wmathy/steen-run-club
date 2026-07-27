import Image from "next/image";
import { cn } from "@/lib/utils";

type AppLogoProps = {
  /** Pixel size for square mark (default 36) */
  size?: number;
  className?: string;
  /** Show rounded frame around the image */
  framed?: boolean;
  priority?: boolean;
};

/**
 * Steen Run Club brand mark from /public/logo.png
 */
export function AppLogo({
  size = 36,
  className,
  framed = true,
  priority = false,
}: AppLogoProps) {
  const img = (
    <Image
      src="/logo.png"
      alt="Steen Run Club"
      width={size}
      height={size}
      priority={priority}
      className={cn(
        "object-cover",
        framed ? "h-full w-full" : "rounded-xl",
        !framed && className,
      )}
    />
  );

  if (!framed) {
    return img;
  }

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-xl bg-accent-soft ring-1 ring-card-border",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {img}
    </div>
  );
}
