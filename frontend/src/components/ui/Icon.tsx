import { type ComponentType, type SVGProps } from 'react';

export interface IconProps extends SVGProps<SVGSVGElement> {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  size?: number | string;
  className?: string;
}

export function Icon({ icon: Component, size = 20, className = '', strokeWidth = 1.5, ...props }: IconProps) {
  return (
    <Component
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      className={`icon-root ${className}`.trim()}
      aria-hidden="true"
      {...props}
    />
  );
}
