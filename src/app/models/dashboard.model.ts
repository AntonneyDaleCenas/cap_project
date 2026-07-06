export type InspectionStatus = 'Completed' | 'Pending' | 'Flagged';
export type PaymentStatus = 'Paid' | 'Unpaid';
export type DashboardTab = 'business' | 'material';

export interface InspectionRecord {
  id: string;
  businessName: string;
  address: string;
  type: string;
  status: InspectionStatus;
  paymentStatus: PaymentStatus;
  date: string;
  amount: number | null;
}