import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImageUploader } from '../components/ImageUploader';

/** "Take photo" for product images (owner, 2026-10-08). */
describe('image uploader camera', () => {
  it('offers Take photo, which opens the back camera', async () => {
    render(<ImageUploader label="Product image" value={null} folder="products" onChange={() => {}} />);
    const camera = screen.getByTestId('camera-input') as HTMLInputElement;
    expect(camera).toHaveAttribute('capture', 'environment');
    expect(camera).toHaveAttribute('accept', 'image/*');
    const click = vi.spyOn(camera, 'click');
    await userEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    expect(click).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Upload image' })).toBeInTheDocument();
  });
});
