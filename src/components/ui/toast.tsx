"use client";

import { useEffect } from "react";
import { CheckCircle, AlertCircle, X } from "lucide-react";
import { Button } from "./button";

interface ToastProps {
  message: string;
  type: "success" | "error";
  onClose: () => void;
  duration?: number;
}

export function Toast({ message, type, onClose, duration = 3000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  return (
    <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-top-2">
      <div className={`
        flex items-center space-x-3 px-4 py-3 rounded-lg shadow-lg max-w-sm
        ${type === "success" 
          ? "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800" 
          : "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800"
        }
      `}>
        {type === "success" ? (
          <CheckCircle className="h-5 w-5 flex-shrink-0" />
        ) : (
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
        )}
        <p className="text-sm font-medium flex-1">{message}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-6 w-6 p-0 hover:bg-transparent"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
