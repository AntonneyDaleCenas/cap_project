import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-inspection',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './inspection.component.html',
  styleUrls: ['./inspection.component.scss']
})
export class InspectionComponent implements OnInit {
  inspectionForm!: FormGroup;

  truckTypes = ['6 Wheelers', '8 Wheelers', '10 Wheelers'];
  materialKinds = ['Sand', 'Gravel', 'Filling Materials'];

  constructor(private fb: FormBuilder) {}

  ngOnInit(): void {
    this.inspectionForm = this.fb.group({
      haulerName: ['', Validators.required],
      truckPlate: ['', [Validators.required, Validators.maxLength(20)]],
      time: ['', Validators.required],
      truckType: [this.truckTypes[1], Validators.required],
      address: ['', Validators.required],
      sourceOfMaterial: ['', Validators.required],
      kindOfMaterial: [this.materialKinds[0], Validators.required],
      quantity: ['', Validators.required],
      deliveryReceipt: ['', Validators.required],
      deliveryReceiptFile: [null]
    });
  }

  // Convenience getter for easy access to form fields
  get f() {
    return this.inspectionForm.controls;
  }

  // Called when the form is submitted
  onSubmit(): void {
    if (this.inspectionForm.invalid) {
      this.inspectionForm.markAllAsTouched();
      return;
    }

    // Example: prepare payload
    const payload = { ...this.inspectionForm.value };

    // If a file was attached, it will be present in deliveryReceiptFile
    // Here you would typically send payload to a backend service
    console.log('Submitting inspection payload:', payload);
    // simulate success handling
    this.afterSubmitSuccess();
  }

  afterSubmitSuccess(): void {
    // Reset but keep some defaults
    const defaults = {
      truckType: this.truckTypes[1],
      kindOfMaterial: this.materialKinds[0]
    };
    this.inspectionForm.reset({ ...defaults });
  }

  // Reset form fully
  resetForm(): void {
    this.inspectionForm.reset({
      truckType: this.truckTypes[1],
      kindOfMaterial: this.materialKinds[0]
    });
  }

  // Helper to set truck type (e.g., when user selects radio)
  setTruckType(type: string): void {
    if (this.truckTypes.includes(type)) {
      this.inspectionForm.patchValue({ truckType: type });
    }
  }

  // Helper to set material kind
  setMaterialKind(kind: string): void {
    if (this.materialKinds.includes(kind)) {
      this.inspectionForm.patchValue({ kindOfMaterial: kind });
    }
  }

  // Handle file input change for delivery receipt
  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      this.inspectionForm.patchValue({ deliveryReceiptFile: null });
      return;
    }
    const file = input.files[0];
    this.inspectionForm.patchValue({ deliveryReceiptFile: file });
  }
}
