import { Routes } from '@angular/router';
import { LoginComponent } from './login/login.component';
import { SignupComponent } from './signup/signup.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { InspectionComponent } from './inspection/inspection.component';

export const routes: Routes = [
  // default route → login
  { path: '', redirectTo: 'login', pathMatch: 'full' },

  // login page
  { path: 'login', component: LoginComponent },

  // signup page
  { path: 'signup', component: SignupComponent },

  // dashboard page
  { path: 'dashboard', component: DashboardComponent },

  // inspection form for field officers
  { path: 'inspection', component: InspectionComponent },

  // fallback (invalid URL)
  { path: '**', redirectTo: 'login' }
];