import { Request, Response, NextFunction } from 'express';
import { addressService } from './address.service.js';
import { createAddressSchema, updateAddressSchema, updateProfileSchema } from './address.schema.js';

export class AddressController {
  async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const profile = await addressService.getProfile(req.user!.id);
      res.status(200).json({
        success: true,
        data: { profile },
      });
    } catch (err) {
      next(err);
    }
  }

  async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const input = updateProfileSchema.parse(req.body);
      const profile = await addressService.updateProfile(req.user!.id, input);
      res.status(200).json({
        success: true,
        data: { profile },
      });
    } catch (err) {
      next(err);
    }
  }

  async listAddresses(req: Request, res: Response, next: NextFunction) {
    try {
      const addresses = await addressService.listAddresses(req.user!.id);
      res.status(200).json({
        success: true,
        data: { addresses },
      });
    } catch (err) {
      next(err);
    }
  }

  async getAddressById(req: Request, res: Response, next: NextFunction) {
    try {
      const address = await addressService.getAddressById(req.params.id as string, req.user!.id);
      res.status(200).json({
        success: true,
        data: { address },
      });
    } catch (err) {
      next(err);
    }
  }

  async createAddress(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createAddressSchema.parse(req.body);
      const address = await addressService.createAddress(req.user!.id, input);
      res.status(201).json({
        success: true,
        data: { address },
      });
    } catch (err) {
      next(err);
    }
  }

  async updateAddress(req: Request, res: Response, next: NextFunction) {
    try {
      const input = updateAddressSchema.parse(req.body);
      const address = await addressService.updateAddress(
        req.params.id as string,
        req.user!.id,
        input
      );
      res.status(200).json({
        success: true,
        data: { address },
      });
    } catch (err) {
      next(err);
    }
  }

  async deleteAddress(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await addressService.deleteAddress(req.params.id as string, req.user!.id);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async setDefaultAddress(req: Request, res: Response, next: NextFunction) {
    try {
      const address = await addressService.setDefaultAddress(
        req.params.id as string,
        req.user!.id
      );
      res.status(200).json({
        success: true,
        data: { address },
      });
    } catch (err) {
      next(err);
    }
  }
}

export const addressController = new AddressController();
