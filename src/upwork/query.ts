// FR-12: the job-details query asks only for the fields listed in "Data requirements".
// PROVISIONAL: the operation shape, argument names and nesting are confirmed in Phase 0 from the
// query the Upwork job page itself sends (scripts/phase0/analyze-har.ts prints it).

export const JOB_DETAILS_QUERY = `query JobAuthDetails($id: ID!) {
  jobAuthDetails(id: $id) {
    opening {
      job {
        info { title }
        description
        attachments { fileName uri length }
      }
      questions { question }
    }
    buyer {
      enterprise
      info {
        company {
          name
          companyId
          contractDate
          profile { industry size }
        }
        location { city country countryTimezone }
        stats {
          totalCharges { amount }
          totalAssignments
          feedbackCount
        }
        jobs {
          postedCount
          openJobs { title }
        }
      }
      workHistory {
        jobInfo { title }
        feedback { comment }
        feedbackToClient { comment }
        contractorInfo { contractorName }
      }
    }
  }
}`;
