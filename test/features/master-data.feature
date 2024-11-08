Feature: Master data
  In order to test master data
  As a developer
  I want to test user data happy paths

  Background: Login as admin
    Given user logs in http://localhost:5000 as admin with welcome123
    When enter admin in username
    When enter welcome123 in password
    Then user access home page

  Scenario: User add
    Given I am logged in as admin
    When I try to add using add-new button
    Then enter user_name in text