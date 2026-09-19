import { pool } from '../connection.js';
import { logger } from '../../utils/logger.js';

export async function runDevSeed(): Promise<void> {
  const client = await pool.connect();
  try {
    logger.info('Starting development database seed...');
    await client.query('BEGIN');

    // 1. System Configurations
    await client.query(`
      INSERT INTO system_configurations (key, value, description)
      VALUES 
        ('default_markup', '{"markup_percent": 20.00}'::jsonb, 'Global default product markup percentage'),
        ('delivery_fee', '{"fee_lkr": 70.00}'::jsonb, 'Standard flat delivery fee in LKR'),
        ('operating_hours', '{"start": "08:00", "end": "21:00", "timezone": "Asia/Colombo"}'::jsonb, 'Delivery dispatch operational window')
      ON CONFLICT (key) DO UPDATE 
        SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = CURRENT_TIMESTAMP;
    `);

    // 2. Dark Store Hub (Dharga Town Central Hub)
    const storeRes = await client.query(`
      INSERT INTO dark_stores (
        id, code, name, city, address_line, latitude, longitude, radius_km, contact_phone, operating_start_time, operating_end_time
      ) VALUES (
        '018dc3f0-4a82-789a-8b1b-947f61ad8821',
        'DHARGA-01',
        'Dharga Town Central Dark Store',
        'Dharga Town',
        'No. 45, Main Street, Dharga Town',
        6.438200,
        80.027400,
        4.00,
        '+94342270000',
        '08:00:00',
        '21:00:00'
      )
      ON CONFLICT (code) DO UPDATE 
        SET name = EXCLUDED.name, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, updated_at = CURRENT_TIMESTAMP
      RETURNING id;
    `);
    const storeId = storeRes.rows[0].id;

    // 3. Service Area
    await client.query(`
      INSERT INTO service_areas (
        dark_store_id, area_name, center_latitude, center_longitude, radius_meters
      ) VALUES (
        $1, 'Dharga Town 4km Zone', 6.438200, 80.027400, 4000
      )
      ON CONFLICT DO NOTHING;
    `, [storeId]);

    // 4. Categories
    await client.query(`
      INSERT INTO categories (id, name, slug, description, display_order)
      VALUES 
        ('c0000001-0000-0000-0000-000000000001', 'Dairy & Eggs', 'dairy-eggs', 'Fresh milk, butter, cheese, and farm eggs', 1),
        ('c0000001-0000-0000-0000-000000000002', 'Biscuits & Snacks', 'biscuits-snacks', 'Crackers, cookies, and Sri Lankan tea snacks', 2)
      ON CONFLICT (slug) DO UPDATE 
        SET name = EXCLUDED.name, description = EXCLUDED.description, display_order = EXCLUDED.display_order;
    `);

    // 5. Products
    await client.query(`
      INSERT INTO products (
        id, category_id, name, slug, sku, barcode, unit, pack_size, purchase_cost, custom_markup_percent
      ) VALUES 
        (
          'b0000001-0000-0000-0000-000000000001',
          'c0000001-0000-0000-0000-000000000001',
          'Kotmale Fresh Milk 1L',
          'kotmale-fresh-milk-1l',
          'SKU-DAI-001',
          '4792024001011',
          '1 L',
          'Tetra Pack',
          450.00,
          NULL -- Global 20% applies -> 540 LKR
        ),
        (
          'b0000001-0000-0000-0000-000000000002',
          'c0000001-0000-0000-0000-000000000001',
          'Pelwatte Salted Butter 200g',
          'pelwatte-salted-butter-200g',
          'SKU-DAI-002',
          '4792024001028',
          '200 g',
          'Foil Wrap',
          700.00,
          15.00 -- Custom 15% -> 805 LKR
        ),
        (
          'b0000001-0000-0000-0000-000000000003',
          'c0000001-0000-0000-0000-000000000001',
          'Farm Fresh Brown Eggs (10 Pack)',
          'farm-fresh-brown-eggs-10-pack',
          'SKU-EGG-003',
          '4792024001035',
          '10 pcs',
          'Pulp Tray',
          550.00,
          10.00 -- Custom 10% -> 605 LKR
        ),
        (
          'b0000001-0000-0000-0000-000000000004',
          'c0000001-0000-0000-0000-000000000002',
          'Munchee Super Cream Cracker 490g',
          'munchee-super-cream-cracker-490g',
          'SKU-BIS-004',
          '4791003001042',
          '490 g',
          'Packet',
          400.00,
          NULL -- Global 20% applies -> 480 LKR
        ),
        (
          'b0000001-0000-0000-0000-000000000005',
          'c0000001-0000-0000-0000-000000000002',
          'Maliban Gold Marie 300g',
          'maliban-gold-marie-300g',
          'SKU-BIS-005',
          '4791004001059',
          '300 g',
          'Packet',
          250.00,
          NULL -- Global 20% applies -> 300 LKR
        )
      ON CONFLICT (sku) DO UPDATE 
        SET name = EXCLUDED.name, purchase_cost = EXCLUDED.purchase_cost, custom_markup_percent = EXCLUDED.custom_markup_percent;
    `);

    // 6. Inventory Partition (Phase 1 UNTRACKED)
    await client.query(`
      INSERT INTO inventory (dark_store_id, product_id, tracking_mode, quantity_on_hand, quantity_reserved)
      VALUES 
        ($1, 'b0000001-0000-0000-0000-000000000001', 'UNTRACKED', 0, 0),
        ($1, 'b0000001-0000-0000-0000-000000000002', 'UNTRACKED', 0, 0),
        ($1, 'b0000001-0000-0000-0000-000000000003', 'UNTRACKED', 0, 0),
        ($1, 'b0000001-0000-0000-0000-000000000004', 'UNTRACKED', 0, 0),
        ($1, 'b0000001-0000-0000-0000-000000000005', 'UNTRACKED', 0, 0)
      ON CONFLICT (dark_store_id, product_id) DO NOTHING;
    `, [storeId]);

    // 7. Users: Customer, Rider, Admin, Packing Staff
    await client.query(`
      INSERT INTO users (id, phone, email, full_name, role)
      VALUES 
        ('a0000001-0000-0000-0000-000000000001', '+94771234567', 'customer.ahmed@example.com', 'Ahmed Rizvi', 'CUSTOMER'),
        ('a0000001-0000-0000-0000-000000000002', '+94779876543', 'rider.farhan@blynk.lk', 'Farhan Mohamed', 'RIDER'),
        ('a0000001-0000-0000-0000-000000000003', '+94775551122', 'ops.admin@blynk.lk', 'Nawaz Mansoor', 'ADMIN'),
        ('a0000001-0000-0000-0000-000000000004', '+94774443322', 'staff.kasun@blynk.lk', 'Kasun Perera', 'PACKING_STAFF')
      ON CONFLICT (phone) DO UPDATE 
        SET full_name = EXCLUDED.full_name, role = EXCLUDED.role;
    `);

    // 8. Customer Delivery Address
    await client.query(`
      INSERT INTO customer_addresses (
        id, user_id, label, recipient_name, recipient_phone, address_line1, address_line2, city, latitude, longitude, is_default
      ) VALUES (
        'e0000001-0000-0000-0000-000000000001',
        'a0000001-0000-0000-0000-000000000001',
        'Home',
        'Ahmed Rizvi',
        '+94771234567',
        'No. 18, Marikar Street',
        'Near Al-Humaithara Mosque',
        'Dharga Town',
        6.435100,
        80.024300,
        TRUE
      )
      ON CONFLICT (id) DO NOTHING;
    `);

    // 9. Rider Entity Profile
    await client.query(`
      INSERT INTO riders (
        id, user_id, dark_store_id, vehicle_type, vehicle_registration_number, is_available, is_active
      ) VALUES (
        'f0000001-0000-0000-0000-000000000001',
        'a0000001-0000-0000-0000-000000000002',
        $1,
        'MOTORCYCLE',
        'WP-BCX-8842',
        TRUE,
        TRUE
      )
      ON CONFLICT (user_id) DO UPDATE 
        SET vehicle_registration_number = EXCLUDED.vehicle_registration_number, is_available = EXCLUDED.is_available;
    `, [storeId]);

    // 10. Phase 1 Market Suppliers
    await client.query(`
      INSERT INTO suppliers (id, name, code, contact_person, contact_phone, address, notes, is_active)
      VALUES 
        (
          'd0000001-0000-0000-0000-000000000001',
          'Dharga Town Central Grocery',
          'SUP-DHARGA-MAIN',
          'M. Rameez',
          '+94342271111',
          'Main Street, Dharga Town',
          'Primary supplier for dairy, bread, and general FMCG goods',
          TRUE
        ),
        (
          'd0000001-0000-0000-0000-000000000002',
          'Al-Barakah Egg & Poultry Wholesale',
          'SUP-DHARGA-EGGS',
          'A. Hameed',
          '+94342272222',
          'Hospital Road, Dharga Town',
          'Dedicated source for fresh farm brown eggs',
          TRUE
        ),
        (
          'd0000001-0000-0000-0000-000000000003',
          'Nawaz Super City Mart',
          'SUP-DHARGA-ALT',
          'N. Farook',
          '+94342273333',
          'Station Road, Dharga Town',
          'Alternate backup local store for biscuits and snacks',
          TRUE
        )
      ON CONFLICT (code) DO UPDATE 
        SET name = EXCLUDED.name, contact_person = EXCLUDED.contact_person, updated_at = CURRENT_TIMESTAMP;
    `);

    await client.query('COMMIT');
    logger.info('Development database seed completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Development database seed failed, rolled back');
    throw err;
  } finally {
    client.release();
  }
}

// Direct execution: tsx src/database/seeds/dev_seed.ts or node dist/database/seeds/dev_seed.js
const isMainScript =
  process.argv[1] &&
  (process.argv[1].endsWith('dev_seed.ts') ||
    process.argv[1].endsWith('dev_seed.js') ||
    process.argv[1].includes('dev_seed'));

if (isMainScript) {
  runDevSeed()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
