import type { PatientDetails } from './api';
import type { Appointment, Doctor, DoctorClinic } from './types';

/*
 * One booking in progress, kept in memory between the slot picker, Patient details and Review
 * (the Flutter screens passed it as constructor arguments). The time is fixed by the hold: no
 * screen after the slot picker can change it. A reload loses it, and the screens then send the
 * customer back to pick a time.
 */
export type Booking = {
  hold: Appointment;
  doctor: Doctor;
  pairing: DoctorClinic;
  /** Set by Patient details. */
  patient: PatientDetails | null;
  /** Set by Review once the server confirmed it. */
  confirmed: Appointment | null;
};

let current: Booking | null = null;

export const startBooking = (hold: Appointment, doctor: Doctor, pairing: DoctorClinic) => {
  current = { hold, doctor, pairing, patient: null, confirmed: null };
};
/** The booking for this hold id, or null (another hold, or none since a reload). */
export const bookingFor = (holdId: string | null | undefined): Booking | null => (current && current.hold.id === holdId ? current : null);
export const setPatient = (holdId: string, patient: PatientDetails) => { if (current?.hold.id === holdId) current = { ...current, patient }; };
export const setConfirmed = (holdId: string, a: Appointment) => { if (current?.hold.id === holdId) current = { ...current, confirmed: a }; };
export const endBooking = () => { current = null; };
