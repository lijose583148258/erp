export class StockMovementConflictError extends Error {
  readonly code = 'STOCK_MOVEMENT_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'StockMovementConflictError';
  }
}
