import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  [
    // Base visual
    "inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium",
    "ring-offset-background transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50",
    // Mobile touch optimizations
    "touch-action-manipulation select-none",          // elimina delay 300ms
    "active:scale-95 active:brightness-90",            // feedback táctil claro
    // Mínimo área de toque según HIG / Material (44px)
    "min-h-[44px] min-w-[44px]",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline min-h-0 min-w-0",
      },
      size: {
        default: "h-12 px-6 text-base",
        sm: "h-11 rounded-md px-4 text-sm",
        lg: "h-14 rounded-md px-10 text-lg",
        icon: "h-12 w-12 p-0 rounded-xl",
        "icon-sm": "h-11 w-11 p-0 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props} />
  )
})
Button.displayName = "Button"

export { Button, buttonVariants }