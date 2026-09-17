import { Routes } from '@angular/router';
import { CoverComponent } from './cover/cover.component';
import { LoginComponent } from './login/login.component';
import { SignupComponent } from './signup/signup.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { InspectionComponent } from './inspection/inspection.component';
import { adminGuard } from './guards/admin.guard';

export const routes: Routes = [
  // landing page shown before login
  { path: '', redirectTo: 'cover', pathMatch: 'full' },
  { path: 'cover', component: CoverComponent },

  // login page
  { path: 'login', component: LoginComponent },

  // signup page
  { path: 'signup', component: SignupComponent },

  // dashboard page
  { path: 'dashboard', component: DashboardComponent, canActivate: [adminGuard] },

  // inspection form for field officers
  { path: 'inspection', component: InspectionComponent },

  // fallback (invalid URL)
  { path: '**', redirectTo: 'cover' }
];