import { dentalRepository } from './dental.repository.js';
import { ClinicListQueryInput } from './dental.schema.js';
import { AppError } from '../../middleware/error.middleware.js';
import { NO_RATINGS, ratingSummaries } from './doctor-rating.service.js';

export interface ClinicDto {
  id: string;
  name: string;
  city: string;
  address_line: string;
  latitude: number;
  longitude: number;
  contact_phone: string;
  operating_start_time: string;
  operating_end_time: string;
}

export interface ClinicDoctorDto {
  clinic_doctor_id: string;
  doctor_id: string;
  full_name: string;
  specialty: string;
  photo_url: string | null;
  bio: string | null;
  consultation_fee: number | null;
  /** Migration 023: visible ratings only; null average when there are none. */
  rating_average: number | null;
  rating_count: number;
}

function toClinicDto(row: {
  id: string;
  name: string;
  city: string;
  address_line: string;
  latitude: number | string;
  longitude: number | string;
  contact_phone: string;
  operating_start_time: string;
  operating_end_time: string;
}): ClinicDto {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    address_line: row.address_line,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    contact_phone: row.contact_phone,
    operating_start_time: row.operating_start_time,
    operating_end_time: row.operating_end_time,
  };
}

/**
 * Clinic listing/detail business logic (customer-facing, public). Only
 * `is_active=true` clinics/clinic_doctors are ever visible here - admin
 * fields (created_by, raw availability-template CRUD data) are never
 * selected by the repository methods this calls, let alone returned.
 */
export class ClinicService {
  async listClinics(query: ClinicListQueryInput) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;
    const filterParams = { city: query.city, search: query.search };

    const [rows, total] = await Promise.all([
      dentalRepository.findActiveClinics({ ...filterParams, limit, offset }),
      dentalRepository.countActiveClinics(filterParams),
    ]);

    return {
      clinics: rows.map(toClinicDto),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getClinicById(id: string): Promise<ClinicDto> {
    const clinic = await dentalRepository.findActiveClinicById(id);
    if (!clinic) {
      // Same 404 whether the id doesn't exist or the clinic is inactive -
      // never lets a client distinguish "no such id" from "exists but
      // hidden" by probing raw ids (brief's explicit rule).
      throw new AppError('Clinic not found.', 404, 'CLINIC_NOT_FOUND');
    }
    return toClinicDto(clinic);
  }

  async listClinicDoctors(clinicId: string): Promise<ClinicDoctorDto[]> {
    // 404 first if the clinic itself isn't visible - otherwise this route
    // would leak "the clinic exists" for an inactive/nonexistent id via an
    // (empty but 200) doctors list.
    const clinic = await dentalRepository.findActiveClinicById(clinicId);
    if (!clinic) {
      throw new AppError('Clinic not found.', 404, 'CLINIC_NOT_FOUND');
    }

    const rows = await dentalRepository.findActiveClinicDoctors(clinicId);
    const ratings = await ratingSummaries(rows.map((r) => r.doctor_id));
    return rows.map((row) => ({
      ...(ratings.get(row.doctor_id) ?? NO_RATINGS),
      clinic_doctor_id: row.clinic_doctor_id,
      doctor_id: row.doctor_id,
      full_name: row.full_name,
      specialty: row.specialty,
      photo_url: row.photo_url,
      bio: row.bio,
      consultation_fee: row.consultation_fee !== null ? Number(row.consultation_fee) : null,
    }));
  }
}

export const clinicService = new ClinicService();
