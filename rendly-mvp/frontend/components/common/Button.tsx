import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

/** Thin cva wrapper over the .rd-btn system (styles/rendly-theme.css). */
const buttonVariants = cva('rd-btn', {
  variants: {
    variant: {
      default: 'rd-btn--primary',
      secondary: '',
      outline: '',
      ghost: 'rd-btn--ghost',
      accent: 'rd-btn--primary',
      danger: 'rd-btn--danger',
    },
    size: {
      sm: 'rd-btn--sm',
      md: '',
      lg: 'rd-btn--lg',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'md',
  },
});

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={buttonVariants({ variant, size, className })} ref={ref} {...props} />
  )
);
Button.displayName = 'Button';

export { Button, buttonVariants };
