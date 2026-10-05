import { dentalRepository } from './dental.repository.js';
import { availabilityService, DayAvailabilityResult, DaySlotsResult } from './availability.service.js';
import { AppError } from '../../middleware/error.middleware.js';
import { NO_RATINGS, ratingSummaries } from './doctor-rating.service.js';

export interface DoctorClinicDto {
  clinic_doctor_id: string;
  clinic_id: string;
  name: string;
  city: string;
  address_line: string;
  latitude: number;
  longitude: number;
  consultation_fee: number | null;
}

export interface DoctorDto {
  id: string;
  full_name: string;
  specialty: string;
  photo_url: string | null;
  bio: string | null;
  clinics: DoctorClinicDto[];
  /** Migration 023: visible ratings only; null average when there are none. */
  rating_average: number | null;
  rating_count: number;
}

/**
 * Doctor discovery + availability business logic (customer-facing,
 * public). Mirrors clinic.service.ts's active-only visibility rule and
 * layers the clinic-doctor relationship guard the availability/slots
 * endpoints need (brief: never silently compute against a non-relationship).
 */
export class DoctorService {
  async getDoctorById(id: string): Promise<DoctorDto> {
    const doctor = await dentalRepository.findActiveDoctorById(id);
    if (!doctor) {
      throw new AppError('Doctor not found.', 404, 'DOCTOR_NOT_FOUND');
    }

    const [clinicRows, ratings] = await Promise.all([
      dentalRepository.findActiveDoctorClinics(id),
      ratingSummaries([id]),
    ]);
    return {
      ...(ratings.get(id) ?? NO_RATINGS),
      id: doctor.id,
      full_name: doctor.full_name,
      specialty: doctor.specialty,
      photo_url: doctor.photo_url,
      bio: doctor.bio,
      clinics: clinicRows.map((row) => ({
        clinic_doctor_id: row.clinic_doctor_id,
        clinic_id: row.clinic_id,
        name: row.name,
        city: row.city,
        address_line: row.address_line,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        consultation_fee: row.consultation_fee !== null ? Number(row.consultation_fee) : null,
      })),
    };
  }

  /** Resolves and validates the one clinic_doctor_id an availability/slots
   * request is allowed to compute against. 404s on the path resource (the
   * doctor doesn't exist/is inactive) but 400s on the query resource
   * (`clinic_id` doesn't name an active relationship for this doctor -
   * whether because that clinic doesn't exist, is inactive, or this doctor
   * simply doesn't practice there) - never silently computes against a
   * non-relationship either way. */
  private async resolveActiveClinicDoctorId(doctorId: string, clinicId: string): Promise<string> {
    const doctor = await dentalRepository.findActiveDoctorById(doctorId);
    if (!doctor) {
      throw new AppError('Doctor not found.', 404, 'DOCTOR_NOT_FOUND');
    }

    const relationship = await dentalRepository.findActiveClinicDoctorRelationship(doctorId, clinicId);
    if (!relationship) {
      throw new AppError(
        'clinic_id does not name an active clinic this doctor practices at.',
        400,
        'CLINIC_DOCTOR_MISMATCH'
      );
    }

    return relationship.clinic_doctor_id;
  }

  async getDoctorAvailability(
    doctorId: string,
    clinicId: string,
    from: string,
    to: string
  ): Promise<DayAvailabilityResult[]> {
    const clinicDoctorId = await this.resolveActiveClinicDoctorId(doctorId, clinicId);
    return await availabilityService.computeRangeAvailability(clinicDoctorId, from, to);
  }

  async getDoctorSlots(doctorId: string, clinicId: string, date: string): Promise<DaySlotsResult> {
    const clinicDoctorId = await this.resolveActiveClinicDoctorId(doctorId, clinicId);
    return await availabilityService.computeDaySlots(clinicDoctorId, date);
  }
}

export const doctorService = new DoctorService();
