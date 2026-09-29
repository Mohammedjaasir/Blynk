-- Migration 013 DOWN: remove customer feedback (and every stored message).
DROP TABLE IF EXISTS customer_feedback;
