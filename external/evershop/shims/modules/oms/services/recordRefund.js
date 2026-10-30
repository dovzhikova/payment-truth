// Payment Truth shim: refunds are not exercised by scenarios A1-A3.
export const recordRefund = async () => { throw new Error('recordRefund is not shimmed'); };
