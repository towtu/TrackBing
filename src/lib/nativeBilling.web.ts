export type StoreProduct = {
  id: string;
  price: string;
  basePlan?: string;
  offerToken?: string;
};
export async function connectStore(
  _products: unknown,
  _owner: string,
  _onVerified: () => void,
  _onError?: (message:string)=>void,
): Promise<
  {
    products: StoreProduct[];
    buy: (product: StoreProduct) => Promise<void>;
    restore: () => Promise<void>;
    manage: () => Promise<void>;
    dispose: () => void;
  }
> {
  throw new Error("Use web checkout in your browser.");
}
