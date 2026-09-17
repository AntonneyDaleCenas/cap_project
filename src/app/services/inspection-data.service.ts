import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class InspectionDataService {
  private readonly supabase: SupabaseClient = createClient(
    environment.supabaseUrl,
    environment.supabaseAnonKey
  );
  private readonly pendingInspectionsKey = 'pending-inspections';

  constructor() {}

  async getPenaltyRate(): Promise<number> {
    const { data, error } = await this.supabase
      .from('app_settings')
      .select('penalty_rate')
      .eq('setting_key', 'inspection')
      .maybeSingle();

    if (error) {
      throw error;
    }

    const rate = Number((data as Record<string, unknown> | null)?.['penalty_rate']);
    return Number.isFinite(rate) && rate > 0 ? rate : 75;
  }

  async updatePenaltyRate(penaltyRate: number): Promise<void> {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('loggedInRole') !== 'admin') {
      throw new Error('Only administrators can change the penalty rate.');
    }

    const { error } = await this.supabase
      .from('app_settings')
      .update({ penalty_rate: penaltyRate, updated_at: new Date().toISOString() })
      .eq('setting_key', 'inspection');

    if (error) {
      throw error;
    }
  }

  private readPendingInspections(): Array<Record<string, unknown>> {
    if (typeof localStorage === 'undefined') {
      return [];
    }

    try {
      const raw = localStorage.getItem(this.pendingInspectionsKey);
      return raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
    } catch {
      return [];
    }
  }

  private writePendingInspections(items: Array<Record<string, unknown>>): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.setItem(this.pendingInspectionsKey, JSON.stringify(items));
  }

  queueInspection(payload: Record<string, unknown>): void {
    const pending = this.readPendingInspections();
    const item = {
      id: `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      payload,
      storedAt: new Date().toISOString()
    };
    this.writePendingInspections([...pending, item]);
  }

  getPendingInspectionsCount(): number {
    return this.readPendingInspections().length;
  }

  getPendingInspections(): Array<{ id: string; payload: Record<string, unknown>; storedAt: string }> {
    return this.readPendingInspections().map((item) => ({
      id: String(item['id'] ?? ''),
      payload: (item['payload'] as Record<string, unknown>) ?? {},
      storedAt: String(item['storedAt'] ?? '')
    }));
  }

  async syncPendingInspections(): Promise<number> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return 0;
    }

    const pending = this.readPendingInspections();
    if (pending.length === 0) {
      return 0;
    }

    let synced = 0;
    const remaining: Array<Record<string, unknown>> = [];

    for (const item of pending) {
      try {
        const payload = item['payload'] as Record<string, unknown>;
        const { error } = await this.supabase.rpc('submit_inspection', { payload });
        if (error) {
          throw error;
        }
        synced += 1;
      } catch (error) {
        console.error('Failed to sync queued inspection:', error);
        remaining.push(item);
      }
    }

    this.writePendingInspections(remaining);
    return synced;
  }

  async listInspections(): Promise<Record<string, unknown>[]> {
    const [{ data, error }, { data: assessments, error: assessmentsError }, { data: payments, error: paymentsError }] = await Promise.all([
      this.supabase
        .from('inspection_dashboard')
        .select('*')
        .order('inspection_date', { ascending: false }),
      this.supabase
        .from('tax_assessment')
        .select('inspection_id, tax_id, status'),
      this.supabase
        .from('payment')
        .select('tax_id, payment_status, receipt_number')
    ]);

    if (error) {
      throw error;
    }
    if (assessmentsError) {
      throw assessmentsError;
    }
    if (paymentsError) {
      throw paymentsError;
    }

    const assessmentByInspection = new Map(
      (assessments ?? []).map((assessment) => [
        String(assessment.inspection_id),
        assessment
      ])
    );
    const paymentByTaxId = new Map(
      (payments ?? []).map((payment) => [String(payment.tax_id), payment])
    );

    const enrichedRecords = (data ?? []).map((record) => {
      const inspectionId = String(record.inspection_id ?? record.id ?? '');
      const assessment = assessmentByInspection.get(inspectionId);
      const payment = assessment ? paymentByTaxId.get(String(assessment.tax_id)) : undefined;

      return {
        ...record,
        assessment_status: assessment?.status ?? record.assessment_status,
        payment_status: payment?.payment_status ?? record.payment_status,
        receipt_number: payment?.receipt_number ?? record.receipt_number
      };
    });

    return enrichedRecords as Record<string, unknown>[];
  }

  async createInspection(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.queueInspection(payload);
      throw new Error('Offline mode: inspection saved locally and will sync when internet is available.');
    }

    try {
      const { data, error } = await this.supabase.rpc('submit_inspection', { payload });
      if (error) {
        throw error;
      }
      return (data ?? {}) as Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        this.queueInspection(payload);
        throw new Error('Offline mode: inspection saved locally and will sync when internet is available.');
      }

      const isNetworkFailure = message.toLowerCase().includes('failed to fetch')
        || message.toLowerCase().includes('network')
        || message.toLowerCase().includes('offline');

      if (isNetworkFailure) {
        this.queueInspection(payload);
        throw new Error('No internet connection. Inspection saved locally and will sync when the connection is restored.');
      }

      throw error;
    }
  }

  async deleteInspection(inspectionId: number | string): Promise<void> {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('loggedInRole') !== 'admin') {
      throw new Error('Only administrators can delete inspections.');
    }

    const normalizedInspectionId = Number(String(inspectionId).replace(/\D/g, '')) || null;
    if (normalizedInspectionId === null) {
      throw new Error('Invalid inspection ID for deletion.');
    }

    const { error } = await this.supabase.rpc('delete_inspection', {
      target_inspection_id: normalizedInspectionId
    });

    if (error) {
      throw error;
    }
  }

  async markInspectionAsPaid(inspectionId: string, receiptNumber: string, cashierNumber: string, amount: number): Promise<void> {
    const cleanedReceipt = receiptNumber?.trim() || '';
    const cleanedCashierNumber = cashierNumber?.trim() || '';
    const normalizedInspectionId = Number(String(inspectionId).replace(/\D/g, '')) || null;

    if (normalizedInspectionId === null) {
      throw new Error('Invalid inspection ID for database update.');
    }

    const { data: taxRow, error: taxLookupError } = await this.supabase
      .from('tax_assessment')
      .select('tax_id')
      .eq('inspection_id', normalizedInspectionId)
      .maybeSingle();

    if (taxLookupError) {
      throw taxLookupError;
    }

    if (!taxRow) {
      throw new Error('No tax assessment found for this inspection.');
    }

    const taxId = Number((taxRow as Record<string, unknown>)['tax_id']);
    const paymentDate = new Date().toISOString().slice(0, 10);

    const { error: assessmentError } = await this.supabase
      .from('tax_assessment')
      .update({ status: 'Paid' })
      .eq('inspection_id', normalizedInspectionId);

    if (assessmentError) {
      throw assessmentError;
    }

    const { data: existingPayment, error: paymentLookupError } = await this.supabase
      .from('payment')
      .select('payment_id')
      .eq('tax_id', taxId)
      .maybeSingle();

    if (paymentLookupError) {
      throw paymentLookupError;
    }

    if (existingPayment) {
      const { error: updatePaymentError } = await this.supabase
        .from('payment')
        .update({
          account_paid: amount,
          payment_date: paymentDate,
          payment_status: 'Paid',
          receipt_number: cleanedReceipt || null,
          cashier_number: cleanedCashierNumber || null
        })
        .eq('tax_id', taxId);

      if (updatePaymentError) {
        throw updatePaymentError;
      }
    } else {
      const { error: insertPaymentError } = await this.supabase
        .from('payment')
        .insert({
          tax_id: taxId,
          account_paid: amount,
          payment_date: paymentDate,
          payment_status: 'Paid',
          cashier_number: cleanedCashierNumber || null,
          receipt_number: cleanedReceipt || null,
          created_at: new Date().toISOString()
        });

      if (insertPaymentError) {
        throw insertPaymentError;
      }
    }

    if (cleanedReceipt) {
      localStorage.setItem(`payment-receipt:${inspectionId}`, cleanedReceipt);
    } else {
      localStorage.removeItem(`payment-receipt:${inspectionId}`);
    }
  }

  async createUser(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const basePayload = {
      ...payload,
      email: String(payload['email'] ?? '').trim().toLowerCase(),
      last_active_at: null
    };
    const { data: existingUser, error: lookupError } = await this.supabase
      .from('users')
      .select('user_id')
      .eq('email', basePayload.email)
      .maybeSingle();

    if (lookupError) {
      throw lookupError;
    }

    if (existingUser) {
      throw new Error('An account with this email already exists.');
    }

    const { error } = await this.supabase
      .from('users')
      .insert(basePayload);

    if (error) {
      throw error;
    }

    return basePayload;
  }

  async findUserByEmail(email: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.supabase
      .from('users')
      .select('user_id, name, email, role, status, password, created_at')
      .eq('email', email.trim())
      .maybeSingle();

    if (error) {
      throw error;
    }

    const user = data as Record<string, unknown> | null;
    if (!user) {
      return null;
    }

    const localChangeKey = `passwordChangedAt:${email.trim().toLowerCase()}`;
    const localChangedAt = localStorage.getItem(localChangeKey);
    if (localChangedAt) {
      return { ...user, password_changed_at: localChangedAt };
    }

    return user;
  }

  async updateUserPassword(email: string, newPassword: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();

    if (normalizedEmail === 'admin@gmail.com') {
      const lastChangedKey = 'adminPasswordLastChangedAt';
      const lastChangedRaw = localStorage.getItem(lastChangedKey);
      const lastChanged = lastChangedRaw ? new Date(lastChangedRaw).getTime() : 0;
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

      if (lastChanged && Date.now() - lastChanged < sevenDaysMs) {
        throw new Error('You can change your password only once every 7 days.');
      }

      localStorage.setItem('adminPasswordOverride', newPassword);
      localStorage.setItem(lastChangedKey, new Date().toISOString());
      return;
    }

    const user = await this.findUserByEmail(normalizedEmail);

    if (!user) {
      throw new Error('Account not found.');
    }

    const lastChangedRaw = user['password_changed_at'] ?? localStorage.getItem(`passwordChangedAt:${normalizedEmail}`);
    const lastChanged = lastChangedRaw ? new Date(String(lastChangedRaw)).getTime() : 0;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    if (lastChanged && Date.now() - lastChanged < sevenDaysMs) {
      throw new Error('You can change your password only once every 7 days.');
    }

    try {
      const { error } = await this.supabase
        .from('users')
        .update({
          password: newPassword,
          password_changed_at: new Date().toISOString()
        })
        .eq('email', normalizedEmail);

      if (!error) {
        localStorage.setItem(`passwordChangedAt:${normalizedEmail}`, new Date().toISOString());
        return;
      }

      const message = error.message.toLowerCase();
      if (!message.includes('password_changed_at') && !message.includes('column')) {
        throw error;
      }

      const { error: fallbackError } = await this.supabase
        .from('users')
        .update({ password: newPassword })
        .eq('email', normalizedEmail);

      if (fallbackError) {
        throw fallbackError;
      }

      localStorage.setItem(`passwordChangedAt:${normalizedEmail}`, new Date().toISOString());
    } catch (error) {
      throw error;
    }
  }

  async listUsers(): Promise<Record<string, unknown>[]> {
    await this.expireInactiveUsers();
    const { data, error } = await this.supabase
      .from('users')
      .select('user_id, name, email, role, status, created_at, last_active_at')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []) as Record<string, unknown>[];
  }

  async validateLogin(email: string, password: string): Promise<Record<string, unknown> | null> {
    const normalizedEmail = email.trim().toLowerCase();

    if (normalizedEmail === 'admin@gmail.com') {
      const adminEmail = 'admin@gmail.com';
      const storedAdminPassword = localStorage.getItem('adminPasswordOverride') ?? 'taxinspection2026';

      if (normalizedEmail === adminEmail && password === storedAdminPassword) {
        return {
          user_id: 'admin-seed',
          name: 'Administrator',
          email: adminEmail,
          role: 'admin',
          status: 'active',
          created_at: new Date().toISOString()
        };
      }

      return null;
    }

    const { data, error } = await this.supabase
      .from('users')
      .select('user_id, name, email, role, status, created_at, last_active_at')
      .eq('email', normalizedEmail)
      .eq('password', password)
      .eq('role', 'officer')
      .maybeSingle();

    if (error) {
      throw error;
    }

    const user = data as Record<string, unknown> | null;
    if (!user || user['status'] !== 'active') {
      return null;
    }

    if (this.isInactiveByTimeout(user)) {
      await this.setUserStatus(normalizedEmail, 'inactive');
      return null;
    }

    return user;
  }

  async setUserStatus(email: string, status: 'active' | 'inactive'): Promise<void> {
    const { error } = await this.supabase
      .from('users')
      .update({ status, last_active_at: status === 'active' ? new Date().toISOString() : null })
      .eq('email', email.trim().toLowerCase())
      .select('user_id')
      .single();

    if (error) {
      throw error;
    }
  }

  private async expireInactiveUsers(): Promise<void> {
    const { data, error } = await this.supabase
      .from('users')
      .select('email, created_at, last_active_at')
      .eq('role', 'officer')
      .eq('status', 'active');

    if (error) {
      throw error;
    }

    for (const user of data ?? []) {
      if (this.isInactiveByTimeout(user as Record<string, unknown>)) {
        await this.setUserStatus(String(user.email), 'inactive');
      }
    }
  }

  private isInactiveByTimeout(user: Record<string, unknown>): boolean {
    const lastActivity = user['last_active_at'] ?? user['created_at'];
    const lastActivityTime = new Date(String(lastActivity)).getTime();
    return Number.isFinite(lastActivityTime)
      && Date.now() - lastActivityTime >= 15 * 24 * 60 * 60 * 1000;
  }
}
