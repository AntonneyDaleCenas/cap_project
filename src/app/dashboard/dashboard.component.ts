import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DashboardTab, InspectionRecord } from '../models/dashboard.model';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  searchControl = new FormControl('', { nonNullable: true });
  
  // Real layout data structures generated matching explicit table values
  inspections: InspectionRecord[] = [
    {
      id: 'INS001',
      businessName: 'Green Valley Market',
      address: '123 Main St',
      type: 'Retail',
      status: 'Completed',
      paymentStatus: 'Paid',
      date: '2026-04-20',
      amount: 15000
    },
    {
      id: 'INS002',
      businessName: 'Sunrise Bakery',
      address: '45 Oak Ave',
      type: 'Food Service',
      status: 'Completed',
      paymentStatus: 'Paid',
      date: '2026-04-22',
      amount: 8200
    },
    {
      id: 'INS003',
      businessName: 'Metro Auto Shop',
      address: '78 Industrial Blvd',
      type: 'Services',
      status: 'Pending',
      paymentStatus: 'Unpaid',
      date: '2026-04-25',
      amount: null
    },
    {
      id: 'INS004',
      businessName: 'City Pharmacy',
      address: '210 Park Rd',
      type: 'Retail',
      status: 'Flagged',
      paymentStatus: 'Unpaid',
      date: '2026-04-18',
      amount: 12300
    }
  ];

  filteredInspections: InspectionRecord[] = [];

  ngOnInit(): void {
    this.filteredInspections = this.inspections;

    // Direct stream hookup binding client inputs to layout grid filter pipeline
    this.searchControl.valueChanges.subscribe((term) => {
      this.applyFilter(term);
    });
  }

  applyFilter(searchTerm: string): void {
    const cleanTerm = searchTerm.toLowerCase().trim();
    if (!cleanTerm) {
      this.filteredInspections = this.inspections;
      return;
    }

    this.filteredInspections = this.inspections.filter(item => 
      item.id.toLowerCase().includes(cleanTerm) ||
      item.businessName.toLowerCase().includes(cleanTerm) ||
      item.address.toLowerCase().includes(cleanTerm) ||
      item.type.toLowerCase().includes(cleanTerm)
    );
  }

  togglePaymentStatus(record: InspectionRecord): void {
    record.paymentStatus = record.paymentStatus === 'Paid' ? 'Unpaid' : 'Paid';
  }

  onSignOut(): void {
    console.log('Terminating secure token session... Redirecting down to auth portal identity route.');
  }
}