import type { ReactNode } from "react";

type PageContainerProps = {
  children: ReactNode;
  className?: string;
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl";
};

const maxWidthMap = {
  sm: "max-w-xl",
  md: "max-w-2xl",
  lg: "max-w-3xl",
  xl: "max-w-4xl",
  "2xl": "max-w-5xl",
};

export function PageContainer({ children, className, maxWidth = "xl" }: PageContainerProps) {
  return (
    <main
      className={`w-full py-10 pb-24 md:pb-10 relative z-10 ${className ?? ""}`}
      style={{ paddingLeft: "clamp(1rem, 4vw, 3rem)", paddingRight: "clamp(1rem, 4vw, 3rem)" }}
    >
      {children}
    </main>
  );
}
