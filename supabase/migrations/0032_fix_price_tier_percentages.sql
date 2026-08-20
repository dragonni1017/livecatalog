-- Fix price_tiers.discount_percent: the app's stored base price
-- (products.price_cents) is already the Wholesale price, not the Retail
-- anchor -- lib/erply.ts's sync multiplies Erply's Retail price by
-- WHOLESALE_DISCOUNT=0.5 before writing it to Supabase. The original
-- 0028_price_tiers.sql values (Retail 0%, Wholesale 50% off, ...) assumed
-- the stored base WAS Retail, so every non-Wholesale tier was wrong:
-- Wholesale double-discounted an already-discounted price, and Retail
-- displayed the Wholesale price unchanged.
--
-- Corrected relative to the actual stored (Wholesale) base, using the real
-- live Erply relationships (Wholesale=50% off Retail, Distribution-Chain=
-- 54% off Retail, Exclusive=38% off Retail -- see
-- docs/memory/project-retail-anchor-pricing-flip.md):
--   Wholesale             = base                    -> 0%
--   Retail   = base / 0.50 = base * 2.00             -> -100% (markup)
--   Distribution-Chain = (base*2)*(1-0.54) = base*0.92 -> 8% off
--   Exclusive           = (base*2)*(1-0.38) = base*1.24 -> -24% (markup)
--
-- applyTierDiscount() (lib/order-rules.ts) already handles negative
-- percentages correctly as markups -- cents*(1-discountPercent/100) -- this
-- migration just corrects the stored values and widens the CHECK
-- constraint that previously only allowed 0-100.
--
-- Base is deactivated rather than assigned a guessed value: it predates
-- the 2026-08-04 retail-anchor pricing flip, has 0 customers in Erply, and
-- has no live reference price to derive a correct number from.

alter table price_tiers drop constraint if exists price_tiers_discount_percent_check;
alter table price_tiers add constraint price_tiers_discount_percent_check
  check (discount_percent >= -100 and discount_percent <= 100);

update price_tiers set discount_percent = 0,    active = true  where code = 'wholesale';
update price_tiers set discount_percent = -100, active = true  where code = 'retail';
update price_tiers set discount_percent = 8,    active = true  where code = 'distribution_chain';
update price_tiers set discount_percent = -24,  active = true  where code = 'exclusive';
update price_tiers set active = false                          where code = 'base';
