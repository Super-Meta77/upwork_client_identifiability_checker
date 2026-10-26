// FR-12: the job-details query asks only for the fields the extractors read (D-33). The operation
// and field paths match the query Upwork's own job page sends (confirmed live, 2026-10-22).

export const JOB_DETAILS_QUERY = `query JobAuthDetails($id: ID!) {
  jobAuthDetails(id: $id) {
    opening {
      job {
        info { title }
        description
        attachments { fileName }
      }
      questions { question }
    }
    buyer {
      info {
        company { name }
      }
      workHistory {
        feedback { comment }
        feedbackToClient { comment }
        contractorInfo { contractorName }
      }
    }
  }
}`;
