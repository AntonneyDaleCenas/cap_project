import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { InspectionDataService } from '../services/inspection-data.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit {
  loginForm!: FormGroup;
  forgotPasswordForm!: FormGroup;
  showForgotPassword = false;

  constructor(private fb: FormBuilder, private router: Router, private inspectionData: InspectionDataService) {}

  ngOnInit(): void {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });

    this.forgotPasswordForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      newPassword: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required, Validators.minLength(6)]]
    }, { validators: this.passwordsMatchValidator });
  }

  private passwordsMatchValidator(form: FormGroup) {
    const newPassword = form.get('newPassword')?.value;
    const confirmPassword = form.get('confirmPassword')?.value;
    return newPassword === confirmPassword ? null : { passwordsMismatch: true };
  }

  // Helper method to flag error validation states visually
  isFieldInvalid(fieldName: string): boolean {
    const field = this.loginForm.get(fieldName);
    return !!(field && field.invalid && (field.dirty || field.touched));
  }

  isForgotFieldInvalid(fieldName: string): boolean {
    const field = this.forgotPasswordForm.get(fieldName);
    return !!(field && field.invalid && (field.dirty || field.touched));
  }

  toggleForgotPassword(): void {
    this.showForgotPassword = !this.showForgotPassword;
    if (!this.showForgotPassword) {
      this.forgotPasswordForm.reset();
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.loginForm.valid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    const email = (this.loginForm.get('email')?.value ?? '').trim();
    const password = String(this.loginForm.get('password')?.value ?? '');

    try {
      const matchedUser = await this.inspectionData.validateLogin(email, password);

      if (!matchedUser) {
        const message = email.toLowerCase() === 'admin@gmail.com'
          ? 'Invalid administrator email or password.'
          : 'Invalid account, password, or inactive account. Ask an administrator to activate the account.';
        alert(message);
        return;
      }

      const signedInName = String(matchedUser['name'] ?? 'Field Officer');
      const signedInRole = matchedUser['role'] === 'admin' ? 'admin' : 'officer';
      localStorage.setItem('loggedInRole', signedInRole);

      if (signedInRole === 'officer') {
        await this.inspectionData.setUserStatus(email, 'active');
        localStorage.setItem('loggedInInspectorEmail', email);
        localStorage.setItem('loggedInInspectorName', signedInName);
        await this.router.navigate(['/inspection']);
      } else {
        await this.router.navigate(['/dashboard']);
      }
    } catch (error) {
      console.error('Login validation failed:', error);
      alert('Login failed. Please verify the account details and try again.');
    }
  }

  async resetPassword(): Promise<void> {
    if (this.forgotPasswordForm.invalid) {
      this.forgotPasswordForm.markAllAsTouched();
      return;
    }

    const email = (this.forgotPasswordForm.get('email')?.value ?? '').trim();
    const newPassword = String(this.forgotPasswordForm.get('newPassword')?.value ?? '');

    try {
      await this.inspectionData.updateUserPassword(email, newPassword);
      alert('Password updated successfully.');
      this.showForgotPassword = false;
      this.forgotPasswordForm.reset();
    } catch (error) {
      console.error('Password reset failed:', error);
      alert(error instanceof Error ? error.message : 'Password could not be updated.');
    }
  }
}