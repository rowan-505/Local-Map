import * as React from "react";

import { cn } from "@/src/lib/cn";

/**
 * Shell primitives aligned with shadcn/ui Card — Tailwind-only, matches dashboard borders/shadows.
 */
const Card = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(({ className, ...props }, ref) => (
    <div
        ref={ref}
        data-slot="card"
        className={cn(
            "flex flex-col gap-0 rounded-lg border border-gray-200 bg-white text-gray-900 shadow-sm",
            className
        )}
        {...props}
    />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
    ({ className, ...props }, ref) => (
        <div ref={ref} data-slot="card-header" className={cn("flex flex-col gap-1 px-6 pt-6", className)} {...props} />
    )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.ComponentProps<"p">>(
    ({ className, ...props }, ref) => (
        <p
            ref={ref}
            data-slot="card-title"
            className={cn("font-semibold leading-none tracking-tight", className)}
            {...props}
        />
    )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.ComponentProps<"p">>(
    ({ className, ...props }, ref) => (
        <p ref={ref} data-slot="card-description" className={cn("text-sm text-gray-600", className)} {...props} />
    )
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
    ({ className, ...props }, ref) => (
        <div ref={ref} data-slot="card-content" className={cn("px-6 pb-6 pt-0", className)} {...props} />
    )
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
    ({ className, ...props }, ref) => (
        <div
            ref={ref}
            data-slot="card-footer"
            className={cn("flex items-center border-t border-gray-100 px-6 py-4", className)}
            {...props}
        />
    )
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
