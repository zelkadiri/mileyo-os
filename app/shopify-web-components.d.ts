import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  DetailedHTMLProps,
  HTMLAttributes,
  InputHTMLAttributes,
} from "react";

type ShopifyElementProps = DetailedHTMLProps<
  HTMLAttributes<HTMLElement>,
  HTMLElement
> & {
  [key: string]: unknown;
};

type ShopifyButtonProps = DetailedHTMLProps<
  ButtonHTMLAttributes<HTMLButtonElement>,
  HTMLButtonElement
> & {
  [key: string]: unknown;
};

type ShopifyLinkProps = DetailedHTMLProps<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  HTMLAnchorElement
> & {
  [key: string]: unknown;
};

type ShopifyTextFieldProps = DetailedHTMLProps<
  InputHTMLAttributes<HTMLInputElement>,
  HTMLInputElement
> & {
  [key: string]: unknown;
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": ShopifyElementProps;
      "s-box": ShopifyElementProps;
      "s-button": ShopifyButtonProps;
      "s-link": ShopifyLinkProps;
      "s-list-item": ShopifyElementProps;
      "s-page": ShopifyElementProps;
      "s-paragraph": ShopifyElementProps;
      "s-section": ShopifyElementProps;
      "s-stack": ShopifyElementProps;
      "s-text": ShopifyElementProps;
      "s-text-field": ShopifyTextFieldProps;
      "s-unordered-list": ShopifyElementProps;
      "ui-title-bar": ShopifyElementProps;
    }
  }
}

export {};
