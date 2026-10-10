import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles, requireShopper } from '../../middleware/role.middleware.js';
import { dentalController } from './dental.controller.js';
import { appointmentController } from './appointment.controller.js';
import { dentalAdminController } from './dental-admin.controller.js';
import { doctorRatingController } from './doctor-rating.controller.js';
import { requireDoctorsSignIn } from '../configuration/doctors-access.js';

// ----------------------------------------------------------------------------
// 1. CLINICS ROUTER (/api/v1/dental/clinics) - public to browse only when
//    Admin/Operations switch "Doctors need sign-in" off; by default a guest
//    gets 401 SIGN_IN_REQUIRED (owner, 2026-10-10: "If they want to go to the
//    doctors section, they must log in or create an account").
// ----------------------------------------------------------------------------
export const dentalClinicsRouter = Router();
dentalClinicsRouter.use(requireDoctorsSignIn());
dentalClinicsRouter.get('/', dentalController.listClinics.bind(dentalController));
dentalClinicsRouter.get('/:id', dentalController.getClinicById.bind(dentalController));
dentalClinicsRouter.get('/:id/doctors', dentalController.listClinicDoctors.bind(dentalController));

// ----------------------------------------------------------------------------
// 2. DOCTORS ROUTER (/api/v1/dental/doctors) - same sign-in rule as clinics
//    (owner, 2026-10-10).
// ----------------------------------------------------------------------------
export const dentalDoctorsRouter = Router();
dentalDoctorsRouter.use(requireDoctorsSignIn());
dentalDoctorsRouter.get('/:id', dentalController.getDoctorById.bind(dentalController));
dentalDoctorsRouter.get('/:id/availability', dentalController.getDoctorAvailability.bind(dentalController));
dentalDoctorsRouter.get('/:id/slots', dentalController.getDoctorSlots.bind(dentalController));

// ----------------------------------------------------------------------------
// 3. APPOINTMENTS ROUTER (/api/v1/dental/appointments) - task B3. Every route
//    is customer-authenticated; there is no public read here and no new role
//    (common.md rule 4 - `CUSTOMER` and `ADMIN` only).
// ----------------------------------------------------------------------------
export const dentalAppointmentsRouter = Router();
dentalAppointmentsRouter.use(requireAuth, requireShopper());
// `/holds` is declared before `/:id` so the literal path can never be
// swallowed by the UUID param route.
dentalAppointmentsRouter.post('/holds', appointmentController.createHold.bind(appointmentController));
dentalAppointmentsRouter.get('/', appointmentController.list.bind(appointmentController));
dentalAppointmentsRouter.get('/:id', appointmentController.getById.bind(appointmentController));
dentalAppointmentsRouter.post('/:id/confirm', appointmentController.confirm.bind(appointmentController));
dentalAppointmentsRouter.post('/:id/cancel', appointmentController.cancel.bind(appointmentController));
// Migration 023: rate a visit (confirmed, slot over), once.
dentalAppointmentsRouter.post('/:id/rating', doctorRatingController.rate.bind(doctorRatingController));

// ----------------------------------------------------------------------------
// 4. ADMIN DENTAL ROUTER - mounted by modules/admin/index.ts under /admin,
//    the existing prefix pattern. ADMIN role only.
// ----------------------------------------------------------------------------
export const adminDentalRouter = Router();
adminDentalRouter.post(
  '/appointments/:id/cancel',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  appointmentController.adminCancel.bind(appointmentController)
);

// ----------------------------------------------------------------------------
// 4b. ADMIN CRUD (task B4) - clinics, doctors, clinic-doctor pairings,
//     availability templates, blocked dates, and the admin appointment list.
//     Same router as B3's admin-cancel above; every route guarded inline
//     with requireAuth + requireRoles('ADMIN'), matching that route's
//     existing style rather than a single router-level `.use()` (keeps this
//     addition from changing how the already-reviewed B3 route is wired).
// ----------------------------------------------------------------------------
const ADMIN = [requireAuth, requireRoles('ADMIN')] as const;
// Routes the Operations app also calls (migration 014's OPERATIONS role).
const ADMIN_OR_OPS = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS'])] as const;

// Clinics
adminDentalRouter.post('/clinics', ...ADMIN_OR_OPS, dentalAdminController.createClinic.bind(dentalAdminController));
adminDentalRouter.get('/clinics', ...ADMIN_OR_OPS, dentalAdminController.listClinics.bind(dentalAdminController));
adminDentalRouter.get('/clinics/:id', ...ADMIN_OR_OPS, dentalAdminController.getClinicById.bind(dentalAdminController));
adminDentalRouter.patch('/clinics/:id', ...ADMIN_OR_OPS, dentalAdminController.updateClinic.bind(dentalAdminController));

// Doctors
adminDentalRouter.post('/doctors', ...ADMIN_OR_OPS, dentalAdminController.createDoctor.bind(dentalAdminController));
adminDentalRouter.get('/doctors', ...ADMIN_OR_OPS, dentalAdminController.listDoctors.bind(dentalAdminController));
adminDentalRouter.get('/doctors/:id', ...ADMIN, dentalAdminController.getDoctorById.bind(dentalAdminController));
adminDentalRouter.patch('/doctors/:id', ...ADMIN_OR_OPS, dentalAdminController.updateDoctor.bind(dentalAdminController));

// Clinic-doctor relationship (the join table)
adminDentalRouter.post(
  '/clinics/:clinic_id/doctors',
  ...ADMIN_OR_OPS,
  dentalAdminController.attachDoctorToClinic.bind(dentalAdminController)
);
adminDentalRouter.get(
  '/clinics/:clinic_id/doctors',
  ...ADMIN_OR_OPS,
  dentalAdminController.listClinicDoctorRoster.bind(dentalAdminController)
);
adminDentalRouter.patch(
  '/clinic-doctors/:id',
  ...ADMIN_OR_OPS,
  dentalAdminController.updateClinicDoctor.bind(dentalAdminController)
);

// Availability template
adminDentalRouter.post(
  '/clinic-doctors/:clinic_doctor_id/availability',
  ...ADMIN_OR_OPS,
  dentalAdminController.createAvailability.bind(dentalAdminController)
);
adminDentalRouter.get(
  '/clinic-doctors/:clinic_doctor_id/availability',
  ...ADMIN_OR_OPS,
  dentalAdminController.listAvailability.bind(dentalAdminController)
);
adminDentalRouter.patch(
  '/availability/:id',
  ...ADMIN_OR_OPS,
  dentalAdminController.updateAvailability.bind(dentalAdminController)
);
adminDentalRouter.delete(
  '/availability/:id',
  ...ADMIN_OR_OPS,
  dentalAdminController.deleteAvailability.bind(dentalAdminController)
);

// Blocked dates
adminDentalRouter.post(
  '/clinic-doctors/:clinic_doctor_id/blocked-dates',
  ...ADMIN_OR_OPS,
  dentalAdminController.createBlockedDate.bind(dentalAdminController)
);
adminDentalRouter.get(
  '/clinic-doctors/:clinic_doctor_id/blocked-dates',
  ...ADMIN_OR_OPS,
  dentalAdminController.listBlockedDates.bind(dentalAdminController)
);
adminDentalRouter.delete(
  '/blocked-dates/:id',
  ...ADMIN_OR_OPS,
  dentalAdminController.deleteBlockedDate.bind(dentalAdminController)
);

// Appointments (admin visibility) - GET list. Admin-cancel already exists
// above (B3); not duplicated here.
adminDentalRouter.get(
  '/appointments',
  ...ADMIN_OR_OPS,
  dentalAdminController.listAppointments.bind(dentalAdminController)
);

// Doctor ratings (migration 023): the list per doctor, hidden ones included,
// and hide/unhide of an abusive rating.
adminDentalRouter.get(
  '/doctors/:id/ratings',
  ...ADMIN_OR_OPS,
  doctorRatingController.listForDoctor.bind(doctorRatingController)
);
adminDentalRouter.patch(
  '/ratings/:id/hidden',
  ...ADMIN_OR_OPS,
  doctorRatingController.setHidden.bind(doctorRatingController)
);

// ----------------------------------------------------------------------------
// 5. MAIN DENTAL ROUTER (/api/v1/dental) - mounted in app.ts like every
//    other module (`apiRouter.use('/dental', dentalRouter)`).
// ----------------------------------------------------------------------------
export const dentalRouter = Router();
dentalRouter.use('/clinics', dentalClinicsRouter);
dentalRouter.use('/doctors', dentalDoctorsRouter);
dentalRouter.use('/appointments', dentalAppointmentsRouter);

export * from './dental.schema.js';
export * from './dental.repository.js';
export * from './clinic.service.js';
export * from './doctor.service.js';
export * from './availability.service.js';
export * from './dental.controller.js';
export * from './appointment.schema.js';
export * from './appointment.repository.js';
export * from './appointment.service.js';
export * from './appointment.controller.js';
export * from './dental-admin.schema.js';
export * from './dental-admin.repository.js';
export * from './dental-admin.service.js';
export * from './dental-admin.controller.js';
export * from './appointment-reminders.js';
export * from './doctor-rating.service.js';
export * from './doctor-rating.controller.js';
