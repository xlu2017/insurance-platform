-- Remove the obsolete 3-argument overloads of customer approval/decline RPCs.
-- The current versions require expected switching-preferences version as well.
drop function if exists approve_customer_recommendation(uuid, int, int);
drop function if exists decline_customer_recommendation(uuid, int, int);
