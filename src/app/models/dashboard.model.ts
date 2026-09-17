export type InspectionStatus = 'Completed' | 'Pending' | 'Flagged';
export type PaymentStatus = 'Paid' | 'Unpaid';
export type DashboardTab = 'business' | 'material';

export interface InspectionRecord {
  id: string;
  databaseInspectionId?: number;
  businessName: string;
  address: string;
  type: string;
  status: InspectionStatus;
  paymentStatus: PaymentStatus;
  date: string;
  amount: number | null;
  inspector: string;
  note: string;
  receiptNumber?: string;
  cashierNumber?: string;
  quantityCubicMeters?: number;
  allowedVolume?: number;
  excessVolume?: number;
  penaltyRate?: number;
  penaltyAmount?: number;
  createdAt?: string;
}