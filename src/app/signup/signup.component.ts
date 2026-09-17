import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { InspectionDataService } from '../services/inspection-data.service';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './signup.component.html',
  styleUrls: ['./signup.component.scss']
})
export class SignupComponent implements OnInit {
  registerForm!: FormGroup;
  isSubmitting = false;
  showTerms = false;

  constructor(private fb: FormBuilder, private router: Router, private inspectionData: InspectionDataService) {}

  ngOnInit(): void {
    this.registerForm = this.fb.group(
      {
        firstName: ['', Validators.required],
        lastName: ['', Validators.required],
        email: ['', [Validators.required, Validators.email]],
        employeeId: [''],
        password: ['', [Validators.required, Validators.minLength(6), this.passwordComplexityValidator]],
        confirmPassword: ['', Validators.required],
        terms: [false, Validators.requiredTrue]
      },
      {
        validators: this.passwordsMatchValidator
      }
    );
  }

  private passwordComplexityValidator(control: { value: string }) {
    const value = control.value ?? '';
    const hasMinLength = value.length >= 6;
    const hasUppercase = /[A-Z]/.test(value);
    const hasNumber = /\d/.test(value);
    return value && hasMinLength && hasUppercase && hasNumber ? null : { passwordComplexity: true };
  }

  private passwordsMatchValidator(form: FormGroup) {
    const password = form.get('password')?.value;
    const confirmPassword = form.get('confirmPassword')?.value;
    return password === confirmPassword ? null : { passwordsMismatch: true };
  }

  isFieldInvalid(fieldName: string): boolean {
    const field = this.registerForm.get(fieldName);
    return !!(field && field.invalid && (field.touched || field.dirty));
  }

  isPasswordMismatch(): boolean {
    const password = this.registerForm.get('password')?.value;
    const confirmPassword = this.registerForm.get('confirmPassword')?.value;
    return !!password && !!confirmPassword && password !== confirmPassword;
  }

  async onSubmit(): Promise<void> {
    if (this.registerForm.hasError('passwordsMismatch')) {
      this.registerForm.get('password')?.markAsTouched();
      this.registerForm.get('confirmPassword')?.markAsTouched();
      alert('Passwords do not match. Please enter the same password in both fields.');
      return;
    }

    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    const value = this.registerForm.value;
    this.isSubmitting = true;

    try {
      await this.inspectionData.createUser({
        name: `${value.firstName} ${value.lastName}`.trim(),
        email: value.email,
        password: value.password,
        role: 'officer',
        status: 'inactive'
      });
      alert('Account created successfully');
      await this.router.navigate(['/login']);
    } catch (error) {
      console.error('Failed to create account:', error);
      alert(error instanceof Error ? `Account could not be created: ${error.message}` : 'The account could not be created');
    } finally {
      this.isSubmitting = false;
    }
  }

  goBack(): void {
    this.router.navigate(['/login']);
  }

  toggleTerms(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.showTerms = !this.showTerms;
  }
}
