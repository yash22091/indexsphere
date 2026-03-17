"use client";

import { BRAND } from "@/constants/brand";
import Image from "next/image";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function Logo({ className = "", size = "md" }: LogoProps) {
  const sizeClasses = {
    sm: "text-lg font-bold",
    md: "text-xl font-bold", 
    lg: "text-2xl font-bold",
  };

  const logoSizes = {
    sm: 24,
    md: 32,
    lg: 40,
  };

  return (
    <div className={`flex items-center space-x-3 ${className}`}>
      <div className="flex items-center justify-center">
        <Image
          src="/indexsphere-logo.svg"
          alt="Indexsphere Logo"
          width={logoSizes[size]}
          height={logoSizes[size]}
          className="drop-shadow-sm"
        />
      </div>
      <div className="flex flex-col">
        <span className={sizeClasses[size]}>{BRAND.name}</span>
        <span className="text-xs text-muted-foreground">{BRAND.tagline}</span>
      </div>
    </div>
  );
}
