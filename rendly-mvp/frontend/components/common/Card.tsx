import React from 'react';

type DivProps = React.HTMLAttributes<HTMLDivElement>;

/** .rd-card panel with header / content / footer slots separated by hairlines. */
const Card = React.forwardRef<HTMLDivElement, DivProps>(({ className = '', ...props }, ref) => (
  <div ref={ref} className={`rd-card ${className}`} {...props} />
));
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, DivProps>(({ className = '', ...props }, ref) => (
  <div ref={ref} className={`flex flex-col gap-1 px-5 pt-4 pb-3 ${className}`} {...props} />
));
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className = '', ...props }, ref) => <h2 ref={ref} className={`rd-h2 ${className}`} {...props} />
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className = '', ...props }, ref) => <p ref={ref} className={`rd-small rd-muted ${className}`} {...props} />
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, DivProps>(({ className = '', ...props }, ref) => (
  <div ref={ref} className={`px-5 pb-5 ${className}`} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, DivProps>(({ className = '', ...props }, ref) => (
  <div
    ref={ref}
    className={`flex items-center justify-end gap-2 border-t border-[var(--rd-border-faint)] px-5 py-3 ${className}`}
    {...props}
  />
));
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
